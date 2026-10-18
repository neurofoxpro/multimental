class_name OnlineProtocol
extends RefCounted
## Versioned public envelope for the hosted room service. Combat rules stay in RoomRules/MatchCore.
const Rules = preload("res://src/net/room_rules.gd")
const VERSION: int = 1
const SUBPROTOCOL: String = "multimental.v1"
const MAX_PACKET: int = 32768
const MAX_IDENTITY: int = 128
const MAX_ROOM_ID: int = 64
const MAX_TOKEN: int = 128
const KINDS: Array[String] = ["create","join","resume","command","sync","leave","ping"]

static func _text(value: Variant, low: int, high: int) -> bool:
    return value is String and value.length() >= low and value.length() <= high

static func validate(value: Variant) -> Dictionary:
    if not value is Dictionary or value.size() > 10:
        return {"ok":false,"error":"protocol"}
    if value.get("v") != VERSION or value.get("rules") != Rules.RULES:
        return {"ok":false,"error":"version"}
    var kind: Variant = value.get("kind")
    if not kind is String or kind not in KINDS:
        return {"ok":false,"error":"kind"}
    match str(kind):
        "create":
            if value.size() != 5 or not _text(value.get("identity"),32,MAX_IDENTITY) or not value.get("deck") is Array:
                return {"ok":false,"error":"create"}
        "join":
            if value.size() != 7 or not _text(value.get("room"),8,MAX_ROOM_ID) or not _text(value.get("token"),32,MAX_TOKEN) or not _text(value.get("identity"),32,MAX_IDENTITY) or not value.get("deck") is Array:
                return {"ok":false,"error":"join"}
        "resume":
            if value.size() != 6 or not _text(value.get("room"),8,MAX_ROOM_ID) or not _text(value.get("token"),32,MAX_TOKEN) or not _text(value.get("identity"),32,MAX_IDENTITY):
                return {"ok":false,"error":"resume"}
        "command":
            if value.size() != 6 or not _text(value.get("room"),8,MAX_ROOM_ID) or not Rules.is_integer(value.get("seq"),1,1000000) or not value.get("command") is Dictionary:
                return {"ok":false,"error":"command"}
        "sync","leave":
            if value.size() != 4 or not _text(value.get("room"),8,MAX_ROOM_ID):
                return {"ok":false,"error":str(kind)}
        "ping":
            if value.size() != 3:
                return {"ok":false,"error":"ping"}
    return {"ok":true,"message":value.duplicate(true)}

static func decode(bytes: PackedByteArray) -> Dictionary:
    if bytes.is_empty() or bytes.size() > MAX_PACKET:
        return {"ok":false,"error":"packet_size"}
    var text: String = bytes.get_string_from_utf8()
    if text.to_utf8_buffer() != bytes:
        return {"ok":false,"error":"utf8"}
    var parser := JSON.new()
    if parser.parse(text) != OK:
        return {"ok":false,"error":"json"}
    if not parser.data is Dictionary or parser.data.size() > 16:
        return {"ok":false,"error":"envelope"}
    return {"ok":true,"message":parser.data}

static func encode(value: Dictionary) -> PackedByteArray:
    var bytes: PackedByteArray = JSON.stringify(value).to_utf8_buffer()
    return bytes if bytes.size() <= MAX_PACKET else PackedByteArray()
