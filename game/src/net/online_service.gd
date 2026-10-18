class_name OnlineService
extends RefCounted
## Multi-room authority around RoomRules. No combat rule is implemented here.
const Rules = preload("res://src/net/room_rules.gd")
const Deck = preload("res://src/deck_rules.gd")
const Protocol = preload("res://src/net/online_protocol.gd")
const DEFAULT_MAX_ROOMS: int = 64
const DEFAULT_WAITING_TTL_MS: int = 300000
const DEFAULT_FINISHED_TTL_MS: int = 60000
const DEFAULT_RATE_WINDOW_MS: int = 10000
const DEFAULT_RATE_REQUESTS: int = 80
var rooms: Dictionary = {}
var peer_rooms: Dictionary = {}
var rates: Dictionary = {}
var max_rooms: int = DEFAULT_MAX_ROOMS
var waiting_ttl_ms: int = DEFAULT_WAITING_TTL_MS
var finished_ttl_ms: int = DEFAULT_FINISHED_TTL_MS
var rate_window_ms: int = DEFAULT_RATE_WINDOW_MS
var rate_requests: int = DEFAULT_RATE_REQUESTS

func _init(config: Dictionary = {}) -> void:
    max_rooms = clampi(int(config.get("max_rooms",DEFAULT_MAX_ROOMS)),1,1024)
    waiting_ttl_ms = clampi(int(config.get("waiting_ttl_ms",DEFAULT_WAITING_TTL_MS)),1000,3600000)
    finished_ttl_ms = clampi(int(config.get("finished_ttl_ms",DEFAULT_FINISHED_TTL_MS)),1000,3600000)
    rate_window_ms = clampi(int(config.get("rate_window_ms",DEFAULT_RATE_WINDOW_MS)),1000,60000)
    rate_requests = clampi(int(config.get("rate_requests",DEFAULT_RATE_REQUESTS)),1,10000)

static func _secure_text(value: Variant, low: int, high: int) -> bool:
    if not value is String or value.length() < low or value.length() > high:
        return false
    for ch in value:
        if ch not in "0123456789abcdef":
            return false
    return true

func _limited(peer: int, now: int) -> bool:
    var row: Dictionary = rates.get(peer,{"start":now,"count":0})
    if now - int(row.start) >= rate_window_ms:
        row = {"start":now,"count":0}
    row.count = int(row.count) + 1
    rates[peer] = row
    return int(row.count) > rate_requests

func _entropy(value: Dictionary) -> Dictionary:
    var room: String = str(value.get("room",""))
    var token: String = str(value.get("token",""))
    var seed: int = int(value.get("seed",0))
    if room.is_empty():
        room = Crypto.new().generate_random_bytes(12).hex_encode()
    if token.is_empty():
        token = Crypto.new().generate_random_bytes(32).hex_encode()
    if seed <= 0:
        seed = int(Crypto.new().generate_random_bytes(4).decode_u32(0) % 2147483646) + 1
    if not _secure_text(room,8,Protocol.MAX_ROOM_ID) or not _secure_text(token,32,Protocol.MAX_TOKEN) or seed < 1 or seed > 2147483646:
        return {}
    return {"room":room,"token":token,"seed":seed}

func cleanup(now: int) -> void:
    var remove: Array[String] = []
    for id in rooms:
        var row: Dictionary = rooms[id]
        row.authority.tick(now)
        if row.authority.phase == "finished" and int(row.finished_at) == 0:
            row.finished_at = now
        var expired_waiting: bool = row.authority.phase == "waiting" and now - int(row.created_at) >= waiting_ttl_ms
        var expired_finished: bool = int(row.finished_at) > 0 and now - int(row.finished_at) >= finished_ttl_ms
        if expired_waiting or expired_finished:
            remove.append(id)
    for id in remove:
        var row: Dictionary = rooms[id]
        for peer in [int(row.host_peer),int(row.guest_peer)]:
            if peer_rooms.get(peer,"") == id:
                peer_rooms.erase(peer)
        rooms.erase(id)

func _player(row: Dictionary, peer: int) -> int:
    if int(row.host_peer) == peer:
        return 0
    if int(row.guest_peer) == peer:
        return 1
    return -1

func _view(row: Dictionary, peer: int) -> Dictionary:
    var player: int = _player(row,peer)
    if player not in [0,1]:
        return {}
    var result: Dictionary = row.authority.view_for(player)
    result.peer_connected = (int(row.guest_peer) >= 2 and row.authority.guest_connected) if player == 0 else int(row.host_peer) >= 2
    return result

func state_messages(id: String, except_peer: int = -1) -> Array[Dictionary]:
    if not rooms.has(id):
        return []
    var row: Dictionary = rooms[id]
    var result: Array[Dictionary] = []
    for peer in [int(row.host_peer),int(row.guest_peer)]:
        if peer >= 2 and peer != except_peer:
            result.append({"peer":peer,"message":{"ok":true,"kind":"state","room":id,"view":_view(row,peer)}})
    return result

func request(peer: int, value: Variant, now: int, entropy: Dictionary = {}) -> Dictionary:
    if typeof(peer) != TYPE_INT or peer < 2 or peer > 2147483646 or typeof(now) != TYPE_INT or now < 0:
        return {"ok":false,"error":"caller"}
    cleanup(now)
    if _limited(peer,now):
        return {"ok":false,"error":"rate_limited"}
    var checked: Dictionary = Protocol.validate(value)
    if not checked.ok:
        return checked
    var message: Dictionary = checked.message
    var kind: String = str(message.kind)
    if kind == "ping":
        return {"ok":true,"kind":"pong","v":Protocol.VERSION,"rules":Rules.RULES}
    if kind == "create":
        if peer_rooms.has(peer) or rooms.size() >= max_rooms:
            return {"ok":false,"error":"room_limit" if rooms.size() >= max_rooms else "already_joined"}
        var deck: Dictionary = Deck.validate_ids(message.deck)
        var generated: Dictionary = _entropy(entropy)
        if not deck.ok or generated.is_empty() or rooms.has(generated.room):
            return {"ok":false,"error":"invalid_deck" if not deck.ok else "entropy"}
        var authority = Rules.new()
        if not authority.configure(generated.seed,generated.token,now,deck.ids).ok:
            return {"ok":false,"error":"configure"}
        var row: Dictionary = {"authority":authority,"host_peer":peer,"guest_peer":-1,"host_identity":message.identity,"guest_identity":"","token":generated.token,"created_at":now,"finished_at":0}
        rooms[generated.room] = row
        peer_rooms[peer] = generated.room
        return {"ok":true,"kind":"created","room":generated.room,"token":generated.token,"player":0,"view":_view(row,peer)}
    var id: String = str(message.get("room",""))
    if not rooms.has(id):
        return {"ok":false,"error":"room_missing"}
    var row: Dictionary = rooms[id]
    if kind == "join":
        if peer_rooms.has(peer) and peer_rooms[peer] != id:
            return {"ok":false,"error":"already_joined"}
        var joined: Dictionary = row.authority.connect_guest(message.token,message.identity,now,message.deck)
        if not joined.ok:
            return joined
        row.guest_peer = peer
        row.guest_identity = message.identity
        peer_rooms[peer] = id
        return {"ok":true,"kind":"joined","room":id,"player":1,"resumed":joined.resumed,"view":_view(row,peer)}
    if kind == "resume":
        if not Crypto.new().constant_time_compare(str(row.token).to_utf8_buffer(),str(message.token).to_utf8_buffer()):
            return {"ok":false,"error":"unauthorized"}
        if message.identity == row.host_identity and int(row.host_peer) < 0:
            row.host_peer = peer
            peer_rooms[peer] = id
            return {"ok":true,"kind":"resumed","room":id,"player":0,"view":_view(row,peer)}
        if message.identity == row.guest_identity and int(row.guest_peer) < 0:
            var resumed: Dictionary = row.authority.connect_guest(message.token,message.identity,now,row.authority.guest_deck)
            if not resumed.ok:
                return resumed
            row.guest_peer = peer
            peer_rooms[peer] = id
            return {"ok":true,"kind":"resumed","room":id,"player":1,"view":_view(row,peer)}
        return {"ok":false,"error":"resume_identity"}
    var player: int = _player(row,peer)
    if player < 0:
        return {"ok":false,"error":"not_member"}
    if kind == "sync":
        row.authority.tick(now)
        return {"ok":true,"kind":"state","room":id,"view":_view(row,peer)}
    if kind == "command":
        var result: Dictionary = row.authority.act(player,message.seq,message.command,now)
        return {"ok":result.ok,"kind":"result","room":id,"result":result,"view":_view(row,peer)}
    if kind == "leave":
        row.authority.resign(player,now)
        row.finished_at = now
        return {"ok":true,"kind":"left","room":id,"view":_view(row,peer)}
    return {"ok":false,"error":"kind"}

func detach_peer(peer: int, now: int) -> String:
    if not peer_rooms.has(peer):
        rates.erase(peer)
        return ""
    var id: String = str(peer_rooms[peer])
    peer_rooms.erase(peer)
    rates.erase(peer)
    if not rooms.has(id):
        return ""
    var row: Dictionary = rooms[id]
    if int(row.host_peer) == peer:
        row.host_peer = -1
    elif int(row.guest_peer) == peer:
        row.guest_peer = -1
        row.authority.disconnect_guest(now)
    return id
