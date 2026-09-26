extends SceneTree
const Geometry = preload("res://src/ui_tap_geometry.gd")
var checks: int = 0
var failures: int = 0
func check(value: bool, text: String) -> void:
    checks += 1
    if not value:
        failures += 1
        print("TAP_GEOMETRY_FAIL " + text)
func _initialize() -> void:
    call_deferred("run_test")
func run_test() -> void:
    root.gui_embed_subwindows = true
    root.content_scale_size = Vector2i(720, 1280)
    root.size = Vector2i(720, 1280)
    var button := Button.new()
    button.position = Vector2(30, 70)
    button.size = Vector2(160, 70)
    root.add_child(button)
    await process_frame
    var direct: Dictionary = Geometry.target(button, root)
    check(direct.ok and not direct.embeddedWindow, "ordinary control uses root")
    button.disabled = true
    check(not Geometry.target(button, root).ok, "disabled target refused")
    button.disabled = false
    button.hide()
    check(not Geometry.target(button, root).ok, "hidden target refused")
    button.show()
    button.position = Vector2(-40, 50)
    check(not Geometry.target(button, root).ok, "clipped target refused")
    button.position = Vector2(30, 70)
    var popup := ConfirmationDialog.new()
    popup.dialog_text = "Confirm target"
    popup.add_theme_constant_override("buttons_min_width", 170)
    popup.add_theme_constant_override("buttons_min_height", 64)
    root.add_child(popup)
    popup.popup(Rect2i(70, 350, 580, 260))
    await process_frame
    await process_frame
    var ok: Button = popup.get_ok_button()
    var first: Dictionary = Geometry.target(ok, root)
    check(first.ok and first.embeddedWindow, "dialog has its own viewport")
    check(ok.size.y >= 64 and ok.size.x >= 170, "minimum dialog targets set through theme constants")
    var old_formula: Vector2 = root.get_screen_transform() * ok.get_global_transform_with_canvas() * (ok.size * 0.5)
    var actual: Vector2 = Vector2(first.tap[0], first.tap[1])
    check(actual.distance_to(old_formula) > 100.0, "old root-only calculation misses dialog offset")
    var shift: Vector2i = Vector2i(0, 90)
    popup.position += shift
    await process_frame
    await process_frame
    var second: Dictionary = Geometry.target(ok, root)
    var moved: Vector2 = Vector2(second.tap[0], second.tap[1]) - actual
    var expected: Vector2 = root.get_screen_transform().basis_xform(Vector2(shift))
    check(second.ok and moved.distance_to(expected) < 3.0, "screen target follows embedded-window relocation")
    popup.hide()
    check(not Geometry.target(ok, root).ok, "hidden popup target refused")
    root.remove_child(button)
    check(not Geometry.target(button, root).ok, "detached target refused")
    button.free()
    popup.queue_free()
    await process_frame
    if failures == 0:
        print("MULTIMENTAL_TAP_GEOMETRY_PASS checks=" + str(checks))
    quit(0 if failures == 0 else 1)
