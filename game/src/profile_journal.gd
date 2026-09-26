extends RefCounted
## Ordered local stream: compact receipts, never accept an old sequence as new.
const Model = preload("res://src/profile_state.gd")
const WINDOW: int = 64

static func valid(value: Variant) -> bool:
    if not Model.valid(value):
        return false
    if not value.has("ordered"):
        return true
    var journal: Variant = value.ordered
    if typeof(journal) != TYPE_DICTIONARY or journal.size() != 2 or not Model.count_value(journal.get("head")):
        return false
    if typeof(journal.get("receipts")) != TYPE_DICTIONARY:
        return false
    var head: int = int(journal.head)
    if journal.receipts.size() != mini(head, WINDOW):
        return false
    for number in range(maxi(1, head - WINDOW + 1), head + 1):
        var receipt: Variant = journal.receipts.get(str(number))
        if typeof(receipt) != TYPE_STRING or receipt.length() != 64:
            return false
        for character in receipt:
            if not character in "0123456789abcdef":
                return false
    return true

static func apply_ordered(profile: Dictionary, sequence: int, command: Dictionary) -> Dictionary:
    if not valid(profile) or sequence <= 0 or sequence > Model.LIMIT:
        return Model.failure("INVALID_SEQUENCE_OR_PROFILE")
    var journal: Dictionary = profile.get("ordered", {"head": 0, "receipts": {}}).duplicate(true)
    # Normalize numeric JSON representation before hashing an idempotency receipt.
    var normalized: Dictionary = JSON.parse_string(JSON.stringify(command, "", true, true))
    var digest: String = JSON.stringify(normalized, "", true, true).sha256_text()
    var key: String = str(sequence)
    if sequence <= int(journal.head):
        if journal.receipts.get(key) == digest:
            return {"ok": true, "duplicate": true, "profile": profile.duplicate(true)}
        return Model.failure("SEQUENCE_CONFLICT" if journal.receipts.has(key) else "STALE_SEQUENCE")
    if sequence != int(journal.head) + 1:
        return Model.failure("SEQUENCE_GAP")
    if command.has("replay"):
        var replay: Variant = command.replay
        if command.get("kind") not in ["record_match", "reward_match"] or typeof(replay) != TYPE_DICTIONARY or typeof(replay.get("rules")) != TYPE_STRING or typeof(replay.get("commands")) != TYPE_ARRAY:
            return Model.failure("INVALID_REPLAY")
        if replay.commands.size() > 1000 or JSON.stringify(replay).to_utf8_buffer().size() > 262144:
            return Model.failure("REPLAY_TOO_LARGE")
    var working: Dictionary = profile.duplicate(true)
    working.receipts = {}
    var result: Dictionary = Model.apply(working, "ordered:" + key, command)
    if not result.ok:
        return result
    working = result.profile
    working.receipts = profile.receipts.duplicate(true)
    if command.has("replay"):
        working.lastMatch.replay = command.replay.duplicate(true)
    journal.head = sequence
    journal.receipts[key] = digest
    journal.receipts.erase(str(sequence - WINDOW))
    working.ordered = journal
    return {"ok": true, "duplicate": false, "profile": working} if valid(working) else Model.failure("INVALID_ORDERED_RESULT")
