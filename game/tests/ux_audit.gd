extends SceneTree
## Measurement fixture only; never uses the personal profile. Units are Godot viewport units.
var samples: Array[Dictionary] = []
func _initialize() -> void:
    call_deferred("run_audit")
func collect(node: Node, rows: Array, viewport: Rect2) -> void:
    if node is Control and node.is_visible_in_tree():
        var control: Control = node
        var rect: Rect2 = control.get_global_rect()
        var clipped: Rect2 = rect.intersection(viewport)
        var parent: Node = control.get_parent()
        var scroll_child: bool = false
        while parent is Control:
            if parent is ScrollContainer:
                scroll_child = true
            if parent.clip_contents:
                clipped = clipped.intersection(parent.get_global_rect())
            parent = parent.get_parent()
        if clipped.has_area() and (control is BaseButton or control is Label or control is LineEdit):
            var text: String = str(control.get("text"))
            rows.append({"path": str(control.get_path()), "type": control.get_class(), "text": text.left(120), "size": [rect.size.x, rect.size.y], "visible_size": [clipped.size.x, clipped.size.y], "font": control.get_theme_font_size("font_size"), "target": control is BaseButton or control is LineEdit, "focus_mode": control.focus_mode, "in_scroll": scroll_child, "fully_in_viewport": viewport.encloses(rect)})
    for child in node.get_children():
        collect(child, rows, viewport)
func run_audit() -> void:
    var directory: String = "user://profile-tests/ux-audit-" + Crypto.new().generate_random_bytes(12).hex_encode()
    var ui = load("res://src/main.tscn").instantiate()
    ui.profile_directory = directory
    ui.profile_legacy_settings = ""
    root.add_child(ui)
    ui.set_process(false)
    for locale in ["ru", "en"]:
        ui.language = locale
        for size in [Vector2i(720, 1280), Vector2i(720, 1440), Vector2i(1280, 720)]:
            root.content_scale_size = size
            root.size = size
            for page in ["menu", "collection", "battle", "shop"]:
                if page == "menu":
                    ui.show_menu()
                elif page == "collection":
                    ui.show_collection()
                elif page == "shop":
                    ui.show_shop()
                else:
                    ui.start_match(true)
                    ui.game.start(42)
                    ui.refresh()
                await process_frame
                await process_frame
                var rows: Array = []
                collect(ui, rows, ui.get_viewport_rect())
                var actual: Vector2 = ui.get_viewport_rect().size
                samples.append({"locale": locale, "requested": [size.x, size.y], "viewport": [actual.x, actual.y], "page": page, "focus_present": get_root().gui_get_focus_owner() != null, "controls": rows})
    ui.queue_free()
    await process_frame
    for filename in ["a.json", "b.json"]:
        DirAccess.remove_absolute(directory.path_join(filename))
    DirAccess.remove_absolute(directory)
    print("MULTIMENTAL_UX_AUDIT_JSON " + JSON.stringify({"schemaVersion": 1, "units": "Godot viewport units; not dp/CSS pixels", "samples": samples, "personalProfileUsed": false}))
    print("MULTIMENTAL_UX_AUDIT_PASS samples=" + str(samples.size()))
    quit(0 if samples.size() == 24 else 1)
