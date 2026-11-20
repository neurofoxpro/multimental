extends Control
## Original procedural role emblems; no rules, private state or borrowed game art.
var kind: String = "fighter"
var tint: Color = Color("e9ca81")
func _ready() -> void:
    mouse_filter = Control.MOUSE_FILTER_IGNORE
    resized.connect(queue_redraw)
func configure(value: String, color: Color) -> void:
    kind = value
    tint = color
    queue_redraw()
func stroke(points: Array[Vector2], width: float = 2.5) -> void:
    for i in range(1, points.size()):
        draw_line(points[i - 1], points[i], tint, width, true)
func _draw() -> void:
    var center: Vector2 = size / 2
    var r: float = minf(size.x, size.y) * 0.4
    if r < 3:
        return
    draw_circle(center, r, Color(tint, 0.08))
    draw_arc(center, r, 0, TAU, 40, Color(tint, 0.4), 1, true)
    match kind:
        "guard":
            var pts: Array[Vector2] = [Vector2(-0.5,-0.5),Vector2(0.5,-0.5),Vector2(0.4,0.2),Vector2(0,0.62),Vector2(-0.4,0.2),Vector2(-0.5,-0.5)]
            var transformed: Array[Vector2] = []
            for p in pts:
                transformed.append(center + p * r)
            stroke(transformed)
            stroke([center + Vector2(0,-0.38)*r, center + Vector2(0,0.36)*r])
        "archer":
            draw_arc(center + Vector2(-0.38,0)*r, r*0.72, -PI/2, PI/2, 24, tint, 2, true)
            stroke([center + Vector2(-0.38,-0.72)*r,center + Vector2(-0.38,0.72)*r],1.5)
            stroke([center + Vector2(-0.62,0)*r,center + Vector2(0.65,0)*r])
            stroke([center + Vector2(0.32,-0.25)*r,center + Vector2(0.65,0)*r,center + Vector2(0.32,0.25)*r])
        "lancer":
            stroke([center + Vector2(0,0.68)*r, center + Vector2(0,-0.55)*r])
            stroke([center + Vector2(-0.25,-0.24)*r, center + Vector2(0,-0.68)*r,center + Vector2(0.25,-0.24)*r])
            stroke([center + Vector2(-0.25,0.18)*r,center + Vector2(0.25,0.18)*r],1.5)
        "flanker":
            for sign_value in [-1,1]:
                stroke([center + Vector2(sign_value*0.15,0.55)*r,center + Vector2(sign_value*0.65,-0.48)*r])
                stroke([center + Vector2(sign_value*0.28,-0.4)*r,center + Vector2(sign_value*0.65,-0.48)*r,center + Vector2(sign_value*0.6,-0.06)*r])
        _:
            stroke([center + Vector2(-0.45,0.52)*r,center + Vector2(0.5,-0.54)*r])
            stroke([center + Vector2(0.12,-0.51)*r,center + Vector2(0.5,-0.54)*r,center + Vector2(0.5,-0.13)*r])
            stroke([center + Vector2(-0.52,0.02)*r,center + Vector2(0.02,0.5)*r])
