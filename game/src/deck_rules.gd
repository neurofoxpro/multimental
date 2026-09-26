extends RefCounted
## Shared, pure alpha deck policy. Stable codes stay independent of translated names.
const POLICY: String = "alpha-15-two-copies-v1"
const CARD_COUNT: int = 30
const SIZE: int = 15
const MAX_COPIES: int = 2
const STARTER: Array[int] = [0, 1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 21, 23, 24]

static func integer(value: Variant, minimum: int, maximum: int) -> bool:
    if typeof(value) not in [TYPE_INT, TYPE_FLOAT]:
        return false
    var number: float = float(value)
    return is_finite(number) and floor(number) == number and number >= minimum and number <= maximum

static func code(id: int) -> String:
    return "c%03d" % id if id >= 0 and id < CARD_COUNT else ""

static func card_id(value: Variant) -> int:
    if typeof(value) != TYPE_STRING or value.length() != 4 or not value.begins_with("c"):
        return -1
    var number: int = value.substr(1).to_int()
    return number if code(number) == value else -1

static func failure(reason: String) -> Dictionary:
    return {"ok": false, "code": reason}

static func validate_ids(value: Variant, draft: bool = false) -> Dictionary:
    if typeof(value) != TYPE_ARRAY or value.size() > SIZE or (not draft and value.size() != SIZE):
        return failure("DECK_SIZE")
    var counts: Dictionary = {}
    var ids: Array[int] = []
    var codes: Array[String] = []
    for item in value:
        if not integer(item, 0, CARD_COUNT - 1):
            return failure("UNKNOWN_CARD")
        var id: int = int(item)
        counts[id] = int(counts.get(id, 0)) + 1
        if int(counts[id]) > MAX_COPIES:
            return failure("COPY_LIMIT")
        ids.append(id)
        codes.append(code(id))
    return {"ok": true, "ids": ids, "cards": codes, "ready": ids.size() == SIZE}

static func validate_codes(value: Variant, inventory: Variant = null, draft: bool = false) -> Dictionary:
    if typeof(value) != TYPE_ARRAY or value.size() > SIZE:
        return failure("DECK_SIZE")
    var ids: Array[int] = []
    for item in value:
        var id: int = card_id(item)
        if id < 0:
            return failure("UNKNOWN_CARD")
        ids.append(id)
    var result: Dictionary = validate_ids(ids, draft)
    if not result.ok or inventory == null:
        return result
    if typeof(inventory) != TYPE_DICTIONARY:
        return failure("INVALID_INVENTORY")
    var used: Dictionary = {}
    for key in result.cards:
        used[key] = int(used.get(key, 0)) + 1
        if not integer(inventory.get(key), 0, 1000000000) or int(used[key]) > int(inventory[key]):
            return failure("CARD_NOT_OWNED")
    return result

static func valid_name(value: Variant) -> bool:
    if typeof(value) != TYPE_STRING or value.strip_edges() != value or value.is_empty() or value.length() > 48:
        return false
    for index in range(value.length()):
        if value.unicode_at(index) < 32 or value.unicode_at(index) == 127:
            return false
    return true

static func valid_key(value: Variant) -> bool:
    if typeof(value) != TYPE_STRING or value.is_empty() or value.length() > 48:
        return false
    for character in value:
        if not character in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-":
            return false
    return true
