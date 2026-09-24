class_name RoomView
extends RefCounted
const Rules = preload("res://src/net/room_rules.gd")
static func valid(v: Variant) -> bool:
    if not v is Dictionary or v.get("v") != 2 or v.get("rules") != Rules.RULES:
        return false
    if v.get("phase") not in ["waiting", "playing", "reconnecting", "finished"] or not v.get("reason") is String:
        return false
    for field in ["revision", "coins", "deck_count", "opponent_hand_count", "opponent_deck_count", "turn_remaining_ms", "reconnect_remaining_ms"]:
        if not Rules.is_integer(v.get(field), 0, 1000000000):
            return false
    if not Rules.is_integer(v.get("active"), 0, 1) or not Rules.is_integer(v.get("winner"), -1, 2) or not Rules.is_integer(v.get("turn"), 1, 1000000) or not Rules.is_integer(v.get("next_sequence"), 1, 1000001):
        return false
    if not v.get("peer_connected") is bool or not v.get("board") is Array or v.board.size() != 9:
        return false
    if not v.get("hand") is Array or v.hand.size() > 100 or not v.get("scores") is Array or v.scores.size() != 2:
        return false
    for id in v.hand:
        if not Rules.is_integer(id, 0, 9):
            return false
    for score in v.scores:
        if not Rules.is_integer(score, 0, 9):
            return false
    for unit in v.board:
        if unit == null:
            continue
        if not unit is Dictionary:
            return false
        if not Rules.is_integer(unit.get("id"), 0, 9) or not Rules.is_integer(unit.get("owner"), 0, 1) or not Rules.is_integer(unit.get("attack"), 0, 1000) or not Rules.is_integer(unit.get("health"), 1, 1000):
            return false
    if not v.get("legal") is Array or v.legal.size() > 1000:
        return false
    for command in v.legal:
        if not Rules.normalize_command(command).ok:
            return false
    return true
