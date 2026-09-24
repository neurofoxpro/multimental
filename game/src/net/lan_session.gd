class_name LanSession
extends Node
## Local-room transport. Certificate pin and capability are shared in an invite.
## No private deck/seed is sent. No unsafe TLS validation mode is used.
signal view_changed(view: Dictionary)
signal connection_changed(status: String)
signal invitation_ready(invitation: String)
const Rules = preload("res://src/net/room_rules.gd")
const Invite = preload("res://src/net/room_invite.gd")
const Channel = preload("res://src/net/json_channel.gd")
const View = preload("res://src/net/room_view.gd")
const PORT: int = 17844
var authority = Rules.new()
var server: TCPServer
var peers: Array[Dictionary] = []
var client: Dictionary = {}
var is_host: bool = false
var running: bool = false
var invitation: String = ""
var invite_data: Dictionary = {}
var current_view: Dictionary = {}
var connection_status: String = "idle"
var identity: String = ""
var tls_options: TLSOptions
var certificate_pem: String = ""
var pending: Dictionary = {}
var was_connected: bool = false
var reconnect_at: int = 0
var reconnect_until: int = 0
var ping_at: int = 0
var close_at: int = 0
var last_host_revision: int = -1
var view_received_at: int = 0
var accepted_window: int = 0
var accepted_count: int = 0

func _now() -> int:
    return int(Time.get_unix_time_from_system() * 1000.0)

func _status(value: String) -> void:
    if connection_status != value:
        connection_status = value
        connection_changed.emit(value)

static func addresses() -> PackedStringArray:
    var found := PackedStringArray()
    for item in Invite.address_options(IP.get_local_interfaces()):
        found.append(str(item.address))
    return found

func host_room(address: String = "", port: int = PORT, seed_value: int = 0) -> Dictionary:
    stop()
    if OS.has_feature("web"):
        return {"ok": false, "error": "web_transport_unavailable"}
    if address.is_empty():
        var list: PackedStringArray = addresses()
        if list.is_empty():
            return {"ok": false, "error": "no_local_address"}
        address = list[0]
    if not Invite.private_address(address) or port < 1024 or port > 65535:
        return {"ok": false, "error": "invalid_address"}
    var crypto := Crypto.new()
    var key: CryptoKey = crypto.generate_rsa(2048)
    if key == null:
        return {"ok": false, "error": "certificate_failed"}
    var cert: X509Certificate = crypto.generate_self_signed_certificate(key, "CN=multimental.local,O=Multimental,C=FI", "20200101000000", "20491231235959")
    if cert == null:
        return {"ok": false, "error": "certificate_failed"}
    certificate_pem = RoomCertificate.pem(cert)
    if certificate_pem.is_empty():
        return {"ok": false, "error": "certificate_failed"}
    tls_options = TLSOptions.server(key, cert)
    var secret: String = crypto.generate_random_bytes(32).hex_encode()
    if seed_value <= 0:
        seed_value = int(crypto.generate_random_bytes(4).decode_u32(0) % 2147483646) + 1
    server = TCPServer.new()
    var error: Error = server.listen(port, "0.0.0.0")
    if error != OK:
        server = null
        return {"ok": false, "error": "port_busy"}
    authority.configure(seed_value, secret, _now())
    is_host = true
    running = true
    invitation = Invite.encode(address, port, certificate_pem.sha256_text(), secret)
    last_host_revision = -1
    _host_publish()
    _status("waiting_guest")
    invitation_ready.emit(invitation)
    return {"ok": true, "invitation": invitation}

func join_room(text: String) -> Dictionary:
    var parsed: Dictionary = Invite.decode(text)
    if not parsed.ok:
        return parsed
    stop()
    if OS.has_feature("web"):
        return {"ok": false, "error": "web_transport_unavailable"}
    invite_data = parsed.invite
    invitation = text
    identity = Crypto.new().generate_random_bytes(32).hex_encode()
    is_host = false
    running = true
    was_connected = false
    reconnect_until = Time.get_ticks_msec() + 15000
    _connect()
    return {"ok": true}

func _connect() -> void:
    var tcp := StreamPeerTCP.new()
    var error: Error = tcp.connect_to_host(invite_data.address, int(invite_data.port))
    if error == OK:
        tcp.set_no_delay(true)
    client = {"tcp": tcp, "tls": null, "channel": Channel.new(), "phase": "tcp", "born": Time.get_ticks_msec(), "last_seen": Time.get_ticks_msec(), "authenticated": false}
    if error != OK:
        _drop_client("connection_failed")
    else:
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
        if ticks - accepted_window >= 1000:
            accepted_window = ticks
            accepted_count = 0
        if server != null and server.is_connection_available():
            var tcp: StreamPeerTCP = server.take_connection()
            if peers.size() >= 2 or accepted_count >= 5:
                tcp.disconnect_from_host()
            else:
                accepted_count += 1
                tcp.set_no_delay(true)
                var channel = Channel.new()
                channel.queue({"kind": "certificate", "pem": certificate_pem})
                peers.append({"tcp": tcp, "tls": null, "channel": channel, "phase": "certificate_out", "born": ticks, "last_seen": ticks, "authenticated": false})
        for peer in peers.duplicate():
            if not _poll_peer(peer, true):
                _drop_peer(peer)
        if ticks >= ping_at:
            ping_at = ticks + 2000
            _host_publish(false)
    else:
        if client.is_empty():
            if ticks >= reconnect_until:
                _status("connection_lost" if was_connected else "connection_failed")
                running = false
            elif ticks >= reconnect_at:
                _connect()
        elif not _poll_peer(client, false):
            _drop_client("reconnecting")
        elif client.get("authenticated", false) and ticks >= ping_at:
            ping_at = ticks + 2000
            client.channel.queue({"kind": "ping"})

func _poll_peer(peer: Dictionary, hosting: bool) -> bool:
    var tcp: StreamPeerTCP = peer.tcp
    tcp.poll()
    var ticks: int = Time.get_ticks_msec()
    if tcp.get_status() == StreamPeerTCP.STATUS_CONNECTING:
        return ticks - int(peer.born) < 10000
    if tcp.get_status() != StreamPeerTCP.STATUS_CONNECTED:
        return false
    if not peer.authenticated and ticks - int(peer.born) > 10000:
        return false
    if peer.authenticated and ticks - int(peer.last_seen) > 10000:
        return false
    if hosting and peer.phase == "certificate_out":
        if not peer.channel.outgoing.is_empty():
            var sent: Array = tcp.put_partial_data(peer.channel.outgoing)
            if sent[0] not in [OK, ERR_BUSY]:
                return false
            peer.channel.outgoing = peer.channel.outgoing.slice(int(sent[1]))
        if peer.channel.outgoing.is_empty():
            var tls := StreamPeerTLS.new()
            if tls.accept_stream(tcp, tls_options) != OK:
                return false
            peer.tls = tls
            peer.phase = "tls"
        return true
    if not hosting and peer.phase == "tcp":
        peer.channel.poll(tcp)
        if peer.channel.failed:
            return false
        var certificates: Array = peer.channel.take()
        if certificates.is_empty():
            return true
        if certificates.size() != 1:
            return false
        var msg: Dictionary = certificates[0]
        if msg.get("kind") != "certificate" or not msg.get("pem") is String or msg.pem.length() > 8192:
            return false
        if not Crypto.new().constant_time_compare(str(msg.pem).sha256_buffer(), str(invite_data.fingerprint).hex_decode()):
            _status("certificate_mismatch")
            running = false
            return false
        var certificate := X509Certificate.new()
        if certificate.load_from_string(msg.pem) != OK:
            return false
        var tls := StreamPeerTLS.new()
        if tls.connect_to_stream(tcp, "multimental.local", TLSOptions.client(certificate)) != OK:
            return false
        peer.tls = tls
        peer.channel = Channel.new()
        peer.phase = "tls"
        return true
    if peer.tls == null:
        return false
    var secure: StreamPeerTLS = peer.tls
    secure.poll()
    if secure.get_status() == StreamPeerTLS.STATUS_HANDSHAKING:
        return true
    if secure.get_status() != StreamPeerTLS.STATUS_CONNECTED:
        return false
    if peer.phase == "tls":
        peer.phase = "messages"
        if not hosting:
            peer.channel.queue({"kind": "hello", "v": Rules.VERSION, "rules": Rules.RULES, "token": invite_data.token, "identity": identity})
    peer.channel.poll(secure)
    if peer.channel.failed:
        return false
    var incoming: Array = peer.channel.take()
    if incoming.size() > 8:
        return false
    for message in incoming:
        peer.last_seen = ticks
        if hosting:
            if not _host_message(peer, message):
                return false
        elif not _client_message(peer, message):
            return false
    return true

func _host_message(peer: Dictionary, message: Dictionary) -> bool:
    var kind: Variant = message.get("kind")
    if not peer.authenticated:
        if kind != "hello" or message.get("v") != Rules.VERSION or message.get("rules") != Rules.RULES or not message.get("token") is String or not message.get("identity") is String:
            return false
        var joined: Dictionary = authority.connect_guest(message.token, message.identity, _now())
        if not joined.ok:
            return false
        peer.authenticated = true
        peer.channel.queue({"kind": "joined", "view": authority.view_for(1)})
        _status("connected")
        _host_publish()
        return true
    match kind:
        "command":
            if message.size() != 3:
                return false
            var result: Dictionary = authority.act(1, message.get("seq"), message.get("command"), _now())
            peer.channel.queue({"kind": "result", "result": result, "view": authority.view_for(1)})
            _host_publish()
        "ping", "sync":
            peer.channel.queue({"kind": "state", "view": authority.view_for(1)})
        "leave":
            authority.resign(1, _now())
            _host_publish()
        _: return false
    return true

func _client_message(peer: Dictionary, message: Dictionary) -> bool:
    if message.get("kind") not in ["joined", "state", "result"] or not View.valid(message.get("view")):
        return false
    var view: Dictionary = message.view
    if not current_view.is_empty() and int(view.revision) < int(current_view.revision):
        return true
    peer.authenticated = true
    was_connected = true
    reconnect_until = 0
    _status("connected")
    current_view = view
    view_received_at = Time.get_ticks_msec()
    if not pending.is_empty():
        if int(view.next_sequence) > int(pending.seq):
            pending = {}
        elif message.kind == "joined":
            peer.channel.queue(pending)
    view_changed.emit(current_view.duplicate(true))
    return true

func _host_publish(emit_local: bool = true) -> void:
    current_view = authority.view_for(0)
    last_host_revision = authority.revision
    view_received_at = Time.get_ticks_msec()
    if emit_local:
        view_changed.emit(current_view.duplicate(true))
    for peer in peers:
        if peer.authenticated:
            peer.channel.queue({"kind": "state", "view": authority.view_for(1)})

func submit(command: Dictionary) -> Dictionary:
    if not running or current_view.is_empty():
        return {"ok": false, "error": "not_connected"}
    if is_host:
        var result: Dictionary = authority.act(0, authority.next_sequence[0], command, _now())
        _host_publish()
        return result
    if client.is_empty() or not client.get("authenticated", false) or not pending.is_empty():
        return {"ok": false, "error": "awaiting_connection_or_ack"}
    var parsed: Dictionary = Rules.normalize_command(command)
    if not parsed.ok:
        return parsed
    pending = {"kind": "command", "seq": int(current_view.next_sequence), "command": parsed.command}
    client.channel.queue(pending)
    return {"ok": true, "pending": true}

func remaining_seconds() -> int:
    if current_view.is_empty():
        return 0
    return maxi(0, int(ceil((int(current_view.turn_remaining_ms) - (Time.get_ticks_msec() - view_received_at)) / 1000.0)))

func _drop_peer(peer: Dictionary) -> void:
    if peer.get("authenticated", false):
        authority.disconnect_guest(_now())
        _status("waiting_reconnect")
    if peer.tls != null:
        peer.tls.disconnect_from_stream()
    peer.tcp.disconnect_from_host()
    peers.erase(peer)
    _host_publish()

func _drop_client(reason: String) -> void:
    if not client.is_empty():
        if client.tls != null:
            client.tls.disconnect_from_stream()
        client.tcp.disconnect_from_host()
    client = {}
    if was_connected and reconnect_until == 0:
        reconnect_until = Time.get_ticks_msec() + Rules.RECONNECT_MS
    reconnect_at = Time.get_ticks_msec() + 1000
    if connection_status != "certificate_mismatch":
        _status(reason)

func interrupt_for_test() -> void:
    if OS.is_debug_build() and not is_host and not client.is_empty():
        _drop_client("reconnecting")

func leave() -> void:
    if is_host and running:
        authority.resign(0, _now())
        _host_publish()
    elif not client.is_empty() and client.get("authenticated", false):
        client.channel.queue({"kind": "leave"})
    close_at = Time.get_ticks_msec() + 300

func stop() -> void:
    running = false
    for peer in peers:
        if peer.get("tls") != null:
            peer.tls.disconnect_from_stream()
        peer.tcp.disconnect_from_host()
    peers.clear()
    if not client.is_empty():
        if client.get("tls") != null:
            client.tls.disconnect_from_stream()
        client.tcp.disconnect_from_host()
    client = {}
    if server != null:
        server.stop()
    server = null
    current_view = {}
    invitation = ""
    invite_data = {}
    pending = {}
    close_at = 0
    reconnect_at = 0
    reconnect_until = 0
    was_connected = false
    _status("idle")

func _exit_tree() -> void:
    stop()
