extends RefCounted
## Coordinates belong to the target's viewport, which can be an embedded dialog Window.
static func target(control: Control, screen_root: Viewport) -> Dictionary:
    if not is_instance_valid(control) or not control.is_inside_tree() or not control.is_visible_in_tree() or screen_root == null:
        return {"ok": false, "code": "HIDDEN_TARGET"}
    if control is BaseButton and control.disabled:
        return {"ok": false, "code": "DISABLED_TARGET"}
    if control.size.x <= 0 or control.size.y <= 0:
        return {"ok": false, "code": "EMPTY_TARGET"}
    var transform: Transform2D = control.get_viewport().get_screen_transform() * control.get_global_transform_with_canvas()
    var rect: Rect2 = transform * Rect2(Vector2.ZERO, control.size)
    var screen: Rect2 = screen_root.get_screen_transform() * screen_root.get_visible_rect()
    if not screen.encloses(rect):
        return {"ok": false, "code": "OFFSCREEN_TARGET"}
    var center: Vector2 = transform * (control.size * 0.5)
    return {"ok": true, "tap": [int(round(center.x)), int(round(center.y))], "screenRect": [rect.position.x, rect.position.y, rect.size.x, rect.size.y], "embeddedWindow": control.get_viewport() != screen_root}
