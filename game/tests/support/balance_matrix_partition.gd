extends RefCounted
## Exhaustive 10x10 ordered matrix split into five bounded CI jobs.
const Competition = preload("res://tests/support/balance_competition.gd")
const GROUPS: Array = [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9]]

static func partition_ok() -> bool:
    var seen: Dictionary = {}
    for group in GROUPS:
        if group.size() != 2:
            return false
        for index in group:
            if index < 0 or index >= Competition.DECKS.size() or seen.has(index):
                return false
            seen[index] = true
    return seen.size() == Competition.DECKS.size()

static func run_part(part: int) -> Dictionary:
    if not partition_ok() or part < 0 or part >= GROUPS.size():
        return {"ok": false, "error": "partition"}
    var count: int = 0
    for left_index in GROUPS[part]:
        var left: String = Competition.DECKS[left_index]
        for right in Competition.DECKS:
            var row: Dictionary = Competition.one(42, left, right, "greedy-positional", 240)
            if not row.get("ok", false) or not row.get("replayVerified", false) or not row.get("canonicalStart", false) or row.get("left", "") != left or row.get("right", "") != right:
                return {"ok": false, "error": "match", "left": left, "right": right}
            count += 1
    return {"ok": true, "rows": count}
