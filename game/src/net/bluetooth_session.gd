class_name BluetoothSession
extends "res://src/net/lan_session.gd"
## Same authority, commands and player view as LAN; authenticated/encrypted RFCOMM transport.
const Radio = preload("res://src/net/bluetooth_channel.gd")
const BT_PREFIX: String = "multimental-bt://join/"
var target_address: String = ""
var radio_peer: Dictionary = {}
var reconnect_radio_at: int = 0
var channel_factory: Callable

static func invitation_token(text: String) -> String:
    text = text.strip_edges()
    if not text.begins_with(BT_PREFIX):
        return ""
    var token: String = text.substr(BT_PREFIX.length())
    return token if RoomInvite.hex(token, 64) else ""

func _new_channel():
    return channel_factory.call() if OS.is_debug_build() and channel_factory.is_valid() else Radio.new()

func host_room(_address: String = "", _port: int = PORT, seed_value: int = 0, chosen: Variant = null) -> Dictionary:
    var parsed_deck: Dictionary = Deck.validate_ids(Deck.STARTER if chosen == null else chosen)
    if not parsed_deck.ok:
        return {"ok": false, "error": "invalid_deck"}
    stop()
    session_deck.assign(parsed_deck.ids)
    if not (OS.is_debug_build() and channel_factory.is_valid()):
        var allowed: Dictionary = Radio.available()
        if not allowed.ok:
            return allowed
    var crypto := Crypto.new()
    var token: String = crypto.generate_random_bytes(32).hex_encode()
    if seed_value <= 0:
        seed_value = int(crypto.generate_random_bytes(4).decode_u32(0) % 2147483646) + 1
    authority.configure(seed_value, token, _now(), session_deck)
    invitation = BT_PREFIX + token
    running = true
    is_host = true
    last_host_revision = -1
    _host_publish()
    var started: Dictionary = _listen()
    if not started.ok:
        stop()
        return started
    _status("waiting_guest")
    invitation_ready.emit(invitation)
    return {"ok": true, "invitation": invitation}

func _listen() -> Dictionary:
    var channel = _new_channel()
    var result: Dictionary = channel.start(true)
    if not result.ok:
        return result
    radio_peer = {"channel": channel, "authenticated": false, "born": Time.get_ticks_msec(), "last_seen": Time.get_ticks_msec(), "radio_ready": false}
    peers = [radio_peer]
    return {"ok": true}

func join_room(text: String, chosen: Variant = null) -> Dictionary:
    var parsed_deck: Dictionary = Deck.validate_ids(Deck.STARTER if chosen == null else chosen)
    if not parsed_deck.ok:
        return {"ok": false, "error": "invalid_deck"}
    var token: String = invitation_token(text)
    if token.is_empty():
        return {"ok": false, "error": "invalid_invite"}
    if target_address.is_empty() and not (OS.is_debug_build() and channel_factory.is_valid()):
        return {"ok": false, "error": "select_paired_device"}
    stop()
    session_deck.assign(parsed_deck.ids)
    invite_data = {"token": token}
    invitation = text
    identity = Crypto.new().generate_random_bytes(32).hex_encode()
    is_host = false
    running = true
    reconnect_until = Time.get_ticks_msec() + 30000
    _connect()
    return {"ok": true}

func _connect() -> void:
    var channel = _new_channel()
    var result: Dictionary = channel.start(false, target_address)
    if not result.ok:
        _status(str(result.error))
        running = false
        return
    client = {"channel": channel, "authenticated": false, "born": Time.get_ticks_msec(), "last_seen": Time.get_ticks_msec(), "radio_ready": false}
    _status("reconnecting" if was_connected else "connecting")

func _process(_delta: float) -> void:
    if not running:
        return
    var ticks: int = Time.get_ticks_msec()
    if close_at > 0 and ticks >= close_at:
        stop()
        return
    if is_host:
        authority.tick(_now())
        if authority.revision != last_host_revision:
            _host_publish()
        if radio_peer.is_empty():
            if authority.phase != "finished" and ticks >= reconnect_radio_at:
                var result: Dictionary = _listen()
                if not result.ok:
                    _status(str(result.error))
                    reconnect_radio_at = ticks + 2000
        elif not _poll_radio(radio_peer, true):
            _drop_radio()
        if ticks >= ping_at:
            ping_at = ticks + 2000
            _host_publish(false)
    else:
        if client.is_empty():
            if ticks >= reconnect_until:
                running = false
                _status("connection_lost" if was_connected else "connection_failed")
            elif ticks >= reconnect_at:
                _connect()
        elif not _poll_radio(client, false):
            _drop_client("reconnecting")
        elif client.authenticated and ticks >= ping_at:
            ping_at = ticks + 2000
            client.channel.queue({"kind": "ping"})

func _poll_radio(peer: Dictionary, hosting: bool) -> bool:
    var state: Dictionary = peer.channel.inspect()
    var now: int = Time.get_ticks_msec()
    if state.status in ["failed", "closed"]:
        return false
    if state.status != "connected":
        return hosting or now - int(peer.born) < 30000
    if not peer.radio_ready:
        peer.radio_ready = true
        peer.last_seen = now
        peer.born = now
        if not hosting:
            peer.channel.queue(_hello())
    if now - int(peer.last_seen) > 10000:
        return false
    var messages: Array = peer.channel.take()
    if messages.size() > 8:
        return false
    for message in messages:
        peer.last_seen = now
        if hosting:
            if not _host_message(peer, message):
                return false
        elif not _client_message(peer, message):
            return false
    return true

func _drop_radio() -> void:
    if radio_peer.is_empty():
        return
    if radio_peer.authenticated:
        authority.disconnect_guest(_now())
        _status("waiting_reconnect")
    radio_peer.channel.close()
    radio_peer = {}
    peers.clear()
    reconnect_radio_at = Time.get_ticks_msec() + 500
    _host_publish()

func _drop_client(reason: String) -> void:
    if not client.is_empty():
        client.channel.close()
    client = {}
    if was_connected and reconnect_until == 0:
        reconnect_until = Time.get_ticks_msec() + Rules.RECONNECT_MS
    reconnect_at = Time.get_ticks_msec() + 1000
    _status(reason)

func stop() -> void:
    running = false
    if not radio_peer.is_empty():
        radio_peer.channel.close()
    radio_peer = {}
    peers.clear()
    if not client.is_empty():
        client.channel.close()
    client = {}
    current_view = {}
    invitation = ""
    invite_data = {}
    pending = {}
    close_at = 0
    reconnect_at = 0
    reconnect_until = 0
    reconnect_radio_at = 0
    was_connected = false
    _status("idle")
