extends "res://src/match_core.gd"
## Test-only oracle copied before CONTENT-03 migration; never used by the game.
func card(id: int) -> Dictionary:
    if id < 0 or id >= CARD_COUNT:
        return {}
    if id >= 20:
        var element: int = id - 20
        var elite_role: int = element % 5
        var elite_stats: Array = [[4, 4, 5], [5, 3, 8], [5, 4, 5], [6, 4, 4], [4, 3, 5]][elite_role]
        return {"id": id, "element": element, "ru": ELITES_RU[element], "en": ELITES_EN[element], "cost": elite_stats[0], "attack": elite_stats[1], "health": elite_stats[2], "role": elite_role, "kind": TYPES[elite_role]}
    var role: int = 0 if id % 2 == 0 else 1 + int(id / 2) % 4
    var stats: Array = [[1, 1, 2], [2, 1, 4], [2, 2, 3], [2, 2, 2], [2, 2, 2]][role]
    return {"id": id, "element": int(id / 2), "ru": NAMES_RU[id], "en": NAMES_EN[id], "cost": stats[0], "attack": stats[1], "health": stats[2], "role": role, "kind": TYPES[role]}
