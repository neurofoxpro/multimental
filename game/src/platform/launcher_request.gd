extends RefCounted
const MODE: String = "ensure_home_shortcut"
const ID: String = "multimental-manual-v1"
const PACKAGE: String = "pro.neurofox.multimental.dev"
static func valid(value: Variant, version: String) -> bool:
    if typeof(value) != TYPE_DICTIONARY or value.size() != 4:
        return false
    if typeof(value.get("schemaVersion")) != TYPE_FLOAT and typeof(value.get("schemaVersion")) != TYPE_INT:
        return false
    if value.schemaVersion != 1 or value.get("mode") != MODE or value.get("expectedVersion") != version:
        return false
    if typeof(value.get("nonce")) != TYPE_STRING or value.nonce.length() != 48:
        return false
    for c in value.nonce:
        if not c in "0123456789abcdef":
            return false
    return true

## Java primitive boolean may arrive as a JNI integer. Never coerce arbitrary truthy data.
static func native_flag(value: Variant) -> Dictionary:
    if typeof(value) == TYPE_BOOL:
        return {"ok": true, "value": value}
    if typeof(value) == TYPE_INT and (value == 0 or value == 1):
        return {"ok": true, "value": value == 1}
    return {"ok": false, "value": false}
