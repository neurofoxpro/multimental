extends SceneTree
var checks: int = 0
var failures: int = 0
func check(value: bool, text: String) -> void:
    checks += 1
    if not value:
        failures += 1
        print("MENU_LAYOUT_FAIL " + text)
func _initialize() -> void:
    call_deferred("run_test")
func run_test() -> void:
    var directory: String = "user://profile-tests/menu-" + Crypto.new().generate_random_bytes(10).hex_encode()
    var ui = load("res://src/main.tscn").instantiate()
    ui.profile_directory = directory
    ui.profile_legacy_settings = ""
    root.add_child(ui)
    ui.set_process(false)
    for locale in ["ru", "en"]:
        ui.language = locale
        for viewport in [Vector2i(720, 1280), Vector2i(720, 1440), Vector2i(1280, 720), Vector2i(640, 480)]:
            root.content_scale_size = viewport
            root.size = viewport
            ui.show_menu()
            await process_frame
            await process_frame
            var scroll: ScrollContainer = ui.find_child("PageScroll", true, false)
            var first: Button = ui.find_child("PlayAI", true, false)
            check(ui.get_viewport_rect().size == Vector2(viewport), "actual viewport matches requested")
            check(scroll != null and scroll.follow_focus, "bounded scroll follows keyboard")
            check(root.gui_get_focus_owner() == first, "predictable initial focus")
            check(ui.get_viewport_rect().encloses(scroll.get_global_rect()), "scroll itself is on screen")
            for control in ui.root.get_children():
                if control is Button:
                    scroll.ensure_control_visible(control)
                    await process_frame
                    await process_frame
                    check(ui.get_viewport_rect().encloses(control.get_global_rect()), "button reachable without clipped lower edge: " + control.text)
                    check(control.custom_minimum_size.y >= 54 and control.get_theme_font_size("font_size") >= 19, "no shrinking targets or fonts to fit")
                    check(control.get_theme_stylebox("focus") is StyleBoxFlat, "visible focus style")
            first.grab_focus()
            await process_frame
            var key := InputEventKey.new()
            key.keycode = KEY_TAB
            key.pressed = true
            root.push_input(key)
            await process_frame
            key.pressed = false
            root.push_input(key)
            check(root.gui_get_focus_owner() != first and root.gui_get_focus_owner() is Button, "Tab moves focus")
    check(not ui.profile.state().has("collection") and not ui.profile.state().has("economy"), "menu navigation grants nothing")
    ui.queue_free()
    await process_frame
    if failures == 0:
        for name in ["a.json", "b.json"]:
            DirAccess.remove_absolute(directory.path_join(name))
        DirAccess.remove_absolute(directory)
        print("MULTIMENTAL_MENU_LAYOUT_PASS checks=" + str(checks))
    quit(0 if failures == 0 else 1)
