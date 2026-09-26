class_name RoomInvite
extends RefCounted
const PREFIX: String = "multimental://join/"
static func private_address(value: String) -> bool:
    if not value.is_valid_ip_address() or value.contains(":"):
        return false
    var parts: PackedStringArray = value.split(".")
    if parts.size() != 4:
        return false
    var first: int = int(parts[0])
    var second: int = int(parts[1])
    return first == 10 or (first == 192 and second == 168) or (first == 172 and second >= 16 and second <= 31) or first == 127
static func hex(value: Variant, size: int) -> bool:
    if not value is String or value.length() != size:
        return false
    for ch in value:
        if not ch in "0123456789abcdef":
            return false
    return true
static func encode(address: String, port: int, fingerprint: String, token: String) -> String:
    var text: String = JSON.stringify({"v": RoomRules.VERSION, "address": address, "port": port, "fingerprint": fingerprint, "token": token})
    return PREFIX + Marshalls.raw_to_base64(text.to_utf8_buffer()).replace("+", "-").replace("/", "_").trim_suffix("=").trim_suffix("=")
static func decode(text: String) -> Dictionary:
    text = text.strip_edges()
    if not text.begins_with(PREFIX) or text.length() > 2048:
        return {"ok": false, "error": "invalid_invite"}
    var raw: String = text.substr(PREFIX.length())
    for ch in raw:
        if not ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_":
            return {"ok": false, "error": "invalid_invite"}
    raw = raw.replace("-", "+").replace("_", "/")
    while raw.length() % 4 != 0:
        raw += "="
    var value: Variant = JSON.parse_string(Marshalls.base64_to_raw(raw).get_string_from_utf8())
    if not value is Dictionary or value.size() != 5:
        return {"ok": false, "error": "invalid_invite"}
    if value.get("v") != RoomRules.VERSION or not value.get("address") is String or not private_address(value.address):
        return {"ok": false, "error": "incompatible_or_nonlocal_invite"}
    if not RoomRules.is_integer(value.get("port"), 1024, 65535) or not hex(value.get("fingerprint"), 64) or not hex(value.get("token"), 64):
        return {"ok": false, "error": "invalid_invite"}
    value.port = int(value.port)
    return {"ok": true, "invite": value}

static func address_options(interfaces: Array) -> Array[Dictionary]:
    var result: Array[Dictionary] = []
    var seen: Dictionary = {}
    for network in interfaces:
        var name: String = str(network.get("friendly", ""))
        if name.is_empty():
            name = str(network.get("name", ""))
        var raw: String = (str(network.get("name", "")) + " " + name).to_lower()
        var score: int = 10
        if "wlan" in raw or "wi-fi" in raw or "wifi" in raw or raw.begins_with("en0 "):
            score = 0
        elif "ethernet" in raw or raw.begins_with("eth"):
            score = 5
        if "tun" in raw or "tap" in raw or "virtual" in raw or "vethernet" in raw or "vpn" in raw or "lte" in raw or "rmnet" in raw:
            score = 50
        for value in network.get("addresses", []):
            var address: String = str(value)
            if private_address(address) and not address.begins_with("127.") and not seen.has(address):
                seen[address] = true
                result.append({"address": address, "name": name, "score": score})
    result.sort_custom(func(a: Dictionary, b: Dictionary): return int(a.score) < int(b.score) if a.score != b.score else str(a.address) < str(b.address))
    return result
