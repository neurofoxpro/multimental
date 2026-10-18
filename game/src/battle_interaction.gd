extends RefCounted
## UI intent only. The published legal command list and core targeting remain authoritative.
const Core = preload("res://src/match_core.gd")
static func available(view: Dictionary, pending: bool = false) -> bool:
    return not view.is_empty() and int(view.get("winner", 0)) == -1 and int(view.get("active", 1)) == 0 and not pending
static func play(view: Dictionary, slot: int, cell: int, direction: int, pending: bool = false) -> Dictionary:
    if not available(view, pending) or direction not in [0,1,2,3]:
        return {}
    for command in view.get("legal", []):
        if command.get("type") == "play" and int(command.hand) == slot and int(command.cell) == cell:
            var placed: Dictionary = command.duplicate(true)
            placed.direction = direction
            return placed
    return {}
static func reason(view: Dictionary, slot: int, pending: bool = false) -> String:
    if slot < 0 or slot >= view.get("hand", []).size():
        return "missing"
    if int(view.get("winner", -1)) != -1:
        return "finished"
    if pending:
        return "pending"
    if int(view.get("active", 1)) != 0:
        return "opponent"
    if int(view.get("placed_cell", -1)) >= 0:
        return "placed"
    if int(Core.new().card(int(view.hand[slot])).cost) > int(view.get("coins", 0)):
        return "coins"
    for command in view.get("legal", []):
        if command.get("type") == "play" and int(command.hand) == slot:
            return "ready"
    return "space"
static func attack(view: Dictionary, source: int, pending: bool = false) -> Dictionary:
    var result: Dictionary = {"command": {}, "targets": [], "allies": 0, "enemies": 0, "cost": 0}
    if source < 0 or source >= view.get("board", []).size() or view.board[source] == null or int(view.board[source].owner) != 0:
        return result
    result.cost = 0 if source == int(view.get("placed_cell", -1)) else 1
    result.targets = Core.new().attack_targets(source, view.board[source], view.board)
    for target in result.targets:
        if int(view.board[target].owner) == 0:
            result.allies += 1
        else:
            result.enemies += 1
    if available(view, pending):
        for command in view.get("legal", []):
            if command.get("type") == "attack" and int(command.source) == source:
                result.command = command.duplicate(true)
                break
    return result
static func cell(view: Dictionary, index: int, hand: int, source: int, direction: int, pending: bool = false) -> Dictionary:
    if index < 0 or index >= view.get("board", []).size():
        return {"kind": "none"}
    if hand >= 0 and available(view, pending):
        var command: Dictionary = play(view, hand, index, direction, pending)
        return {"kind": "play", "command": command} if not command.is_empty() else {"kind": "invalid_placement"}
    var unit: Variant = view.board[index]
    if unit == null:
        return {"kind": "empty"}
    if int(unit.owner) == 0 and available(view, pending):
        return {"kind": "select", "index": -1 if source == index else index}
    return {"kind": "inspect", "id": int(unit.id)}
