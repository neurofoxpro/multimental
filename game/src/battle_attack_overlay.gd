extends Control
## Card-space attack arrows rotate with the selected facing; artwork and text stay upright.
const Core = preload("res://src/match_core.gd")
var rays: Array[Vector2] = []

static func attack_directions(kind: String, facing: int) -> Array[Vector2]:
    var offsets: Array[Vector2i] = [Vector2i(0, -1)]
    if kind == "guard":
        offsets = [Vector2i(-1, 0), Vector2i(0, -1), Vector2i(1, 0)]
    elif kind == "flanker":
        offsets = [Vector2i(-1, -1), Vector2i(1, -1)]
    var result: Array[Vector2] = []
    for offset in offsets:
        result.append(Vector2(Core.rotated(offset, facing)).normalized())
    return result

func configure(kind: String, facing: int) -> void:
    rays = attack_directions(kind, facing)
    queue_redraw()

func _draw() -> void:
    if not visible:
        return
    # Markers are drawn inside the actual floating square card, not beside the board.
    var center := Vector2(size.x * 0.5, size.y * 0.38)
    var radius: float = minf(size.x, size.y) * 0.235
    var length: float = clampf(radius * 0.29, 7.0, 14.0)
    var width: float = length * 0.68
    for ray in rays:
        var tip: Vector2 = center + ray * radius
        var side: Vector2 = Vector2(-ray.y, ray.x)
        var points := PackedVector2Array([tip, tip - ray * length + side * width, tip - ray * length - side * width])
        draw_colored_polygon(points, Color("151d2b"))
        draw_polyline(PackedVector2Array([points[0], points[1], points[2], points[0]]), Color("f4d28b"), 2.0, true)
