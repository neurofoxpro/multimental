extends RefCounted
## Shared geometry of directional attacks. Every pattern rotates clockwise in quarter-turns.
const UP := Vector2i(0, -1)
const RIGHT := Vector2i(1, 0)
const DOWN := Vector2i(0, 1)
const LEFT := Vector2i(-1, 0)

static func rays(kind: String, pattern: String = "") -> Array[Vector2i]:
    match pattern:
        "up_right":
            return [UP, RIGHT]
        "up_left":
            return [UP, LEFT]
        "left_right":
            return [LEFT, RIGHT]
        "up_down":
            return [UP, DOWN]
        "free_target":
            return [UP, RIGHT, DOWN, LEFT, Vector2i(1, -1), Vector2i(1, 1), Vector2i(-1, 1), Vector2i(-1, -1)]
        "":
            match kind:
                "guard":
                    return [UP, LEFT, RIGHT]
                "flanker":
                    return [Vector2i(-1, -1), Vector2i(1, -1)]
                _:
                    return [UP]
    return []

static func valid(pattern: String) -> bool:
    return pattern in ["", "up_right", "up_left", "left_right", "up_down", "free_target"]
