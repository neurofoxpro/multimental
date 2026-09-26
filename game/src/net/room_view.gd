class_name RoomView
extends RefCounted
const Rules = preload("res://src/net/room_rules.gd")
const Core = preload("res://src/match_core.gd")
static func valid(v: Variant) -> bool:
    if not v is Dictionary or v.get("v") != Rules.VERSION or v.get("rules") != Rules.RULES:
        return false
    if v.get("phase") not in ["waiting", "playing", "reconnecting", "finished"] or not v.get("reason") is String:
        return false
    for field in ["revision", "coins", "deck_count", "opponent_hand_count", "opponent_deck_count", "turn_remaining_ms", "reconnect_remaining_ms", "event_id"]:
        if not Rules.is_integer(v.get(field), 0, 1000000000):
            return false
    if not Rules.is_integer(v.get("active"), 0, 1) or not Rules.is_integer(v.get("winner"), -1, 2) or not Rules.is_integer(v.get("turn"), 1, 1000000) or not Rules.is_integer(v.get("next_sequence"), 1, 1000001):
        return false
    if not Rules.is_integer(v.get("placed_cell"), -1, 8):
        return false
    if not v.get("peer_connected") is bool or not v.get("board") is Array or v.board.size() != 9:
        return false
    if not v.get("hand") is Array or v.hand.size() > 100 or not v.get("scores") is Array or v.scores.size() != 2:
        return false
    if not v.get("terrain") is Array or v.terrain.size() != 9 or not v.get("center_unlocked") is bool or not Rules.is_integer(v.get("income_bonus"), 0, 2):
        return false
    var terrain_counts: Dictionary = {}
    for cell in range(9):
        var element: Variant = v.terrain[cell]
        if not Rules.is_integer(element, 0, 8) or int(element) not in (Core.CENTER_ELEMENTS if cell == 4 else Core.OUTER_ELEMENTS):
            return false
        terrain_counts[int(element)] = int(terrain_counts.get(int(element), 0)) + 1
        if int(terrain_counts[int(element)]) > 2:
            return false
    if not v.center_unlocked and (int(v.turn) >= 7 or v.board[4] != null):
        return false
    for id in v.hand:
        if not Rules.is_integer(id, 0, Core.CARD_COUNT - 1):
            return false
    for score in v.scores:
        if not Rules.is_integer(score, 0, 9):
            return false
    for unit in v.board:
        if unit == null:
            continue
        if not unit is Dictionary:
            return false
        if not Rules.is_integer(unit.get("id"), 0, Core.CARD_COUNT - 1) or not Rules.is_integer(unit.get("owner"), 0, 1) or not Rules.is_integer(unit.get("attack"), 0, 1000) or not Rules.is_integer(unit.get("health"), 1, 1000) or not Rules.is_integer(unit.get("direction"), 0, 3):
            return false
    if not v.get("legal") is Array or v.legal.size() > 1000:
        return false
    for command in v.legal:
        if not Rules.normalize_command(command).ok:
            return false
    if not v.get("events") is Array or v.events.size() > 24:
        return false
    for event in v.events:
        if not event is Dictionary or event.get("type") not in ["unit_placed", "damage", "center_unlocked", "income_unlocked"] or not Rules.is_integer(event.get("cell"), 0, 8):
            return false
        if event.type == "damage" and (not Rules.is_integer(event.get("source"), 0, 8) or not Rules.is_integer(event.get("amount"), 1, 1000)):
            return false
        if event.type == "damage" and not Rules.is_integer(event.get("wave", 0), 0, 1):
            return false
        if event.type == "income_unlocked" and not Rules.is_integer(event.get("amount"), 1, 2):
            return false
    return true
