extends SceneTree
const Style = preload("res://src/ui_theme.gd")
var checks: int = 0
var failures: int = 0
func check(value: bool, title: String) -> void:
    checks += 1
    if not value:
        failures += 1
        print("USABILITY_FAIL " + title)
func settle() -> void:
    for frame in range(5):
        await process_frame
func _initialize() -> void:
    call_deferred("run_test")
func run_test() -> void:
    root.gui_embed_subwindows = true
    var directory: String = "user://profile-tests/usability-" + Crypto.new().generate_random_bytes(12).hex_encode()
    var ui = load("res://src/main.tscn").instantiate()
    ui.profile_directory = directory
    ui.profile_legacy_settings = ""
    root.add_child(ui)
    ui.set_process(false)
    check(Style.contrast(Style.TEXT, Style.SURFACE) >= 4.5, "primary text palette contrast")
    check(Style.contrast(Style.MUTED, Color("14263a")) >= 4.5, "inactive text palette contrast")
    for locale in ["ru", "en"]:
        ui.language = locale
        for viewport in [Vector2i(720,1280), Vector2i(720,1440), Vector2i(1280,720), Vector2i(640,480), Vector2i(390,844)]:
            root.content_scale_size = viewport
            root.size = viewport
            var prior: Dictionary = ui.profile.state().duplicate(true)
            ui.show_menu()
            await settle()
            check(ui.get_viewport_rect().size == Vector2(viewport), "actual viewport " + str(viewport))
            check(ui.profile.state() == prior, "navigation alone never grants or saves")
            var menu_scroll: ScrollContainer = ui.root.get_parent()
            var actions: Array[Node] = ui.find_children("*", "Button", true, false)
            check(actions.size() >= 10, "grouped menu still exposes all original actions")
            for action in actions:
                menu_scroll.ensure_control_visible(action)
                await settle()
                check(ui.get_viewport_rect().encloses(action.get_global_rect()), "nested action reachable " + str(action.name) + " " + str(viewport))
                check(action.size.y >= 54 and action.get_theme_font_size("font_size") >= 19, "no shrinking grouped menu controls")
            ui.show_collection()
            await settle()
            var collection = ui.find_child("CollectionScreen", true, false)
            check(collection.new_button.size.x >= 96 and collection.new_button.size.y <= 80, "NEW action never collapses into a thin tall strip")
            check(ui.get_viewport_rect().encloses(collection.new_button.get_global_rect()), "new deck control remains visible")
            ui.show_menu()
            await settle()
            menu_scroll = ui.root.get_parent()
            var play: Button = ui.find_child("PlayAI", true, false)
            menu_scroll.ensure_control_visible(play)
            play.pressed.emit()
            await settle()
            check(ui.battle and ui.find_child("CollectionScreen", true, false) == null, "one-click play uses selected legal deck")
            var selected: Dictionary = ui.Collection.selected(ui.profile.state())
            check(selected.ok and ui.game.initial_decks[0] == selected.ids, "quick play preserves actual selected composition")
            var layout = ui.find_child("BattleLayout", true, false)
            var digest: String = ui.game.digest()
            var screen: Rect2 = ui.get_viewport_rect()
            check(screen.encloses(layout.get_global_rect()), "battle body bounded " + str(viewport))
            for b in ui.board_buttons:
                check(screen.encloses(b.get_global_rect()), "all board cells visible " + str(viewport) + " " + str(b.get_global_rect()))
                check(b.size.x >= 85 and b.size.y >= 85, "board target remains substantial in logical units")
            for id in ["EndTurn", "BattleBack"]:
                var footer: Button = ui.find_child(id, true, false)
                check(screen.encloses(footer.get_global_rect()), "persistent footer visible " + id + " " + str(viewport))
            var hand: ScrollContainer = ui.find_child("HandScroll", true, false)
            layout.scroll.ensure_control_visible(hand)
            await settle()
            check(screen.encloses(hand.get_global_rect()), "hand reachable without being cut by screen " + str(viewport) + " " + str(hand.get_global_rect()))
            check(layout.scroll.get_global_rect().encloses(hand.get_global_rect()), "hand scroll is inside action scroll")
            check(ui.game.digest() == digest, "reflow/scroll never changes turn state")
            ui.game.state.active = 1
            ui.refresh()
            await settle()
            for card in ui.hand_row.get_children():
                check(card.disabled and card.modulate == Color.WHITE, "inactive hand remains non-interactive without global dimming")
                var color: Color = card.get_theme_color("font_disabled_color")
                var background: Color = card.get_theme_stylebox("disabled").bg_color
                check(color.a == 1 and Style.contrast(color, background) >= 4.5, "disabled hand text contrast")
            digest = ui.game.digest()
            ui.request_leave_match()
            await settle()
            check(ui.leave_confirm.visible and ui.game.digest() == digest, "exit asks before interrupting a live match")
            ui.leave_confirm.hide()
            ui.show_menu()
    ui.show_collection()
    var state: Dictionary = ui.profile.state()
    var selected_id: String = state.collection.selected
    var cards: Array = state.decks[selected_id].duplicate()
    cards.pop_back()
    check(ui.profile.commit({"kind":"deck_save", "id": selected_id, "name": state.collection.names[selected_id], "cards": cards}), "incomplete draft fixture stored")
    ui.show_menu()
    await settle()
    check(ui.find_child("PlayAI", true, false).text == ui.t("ВЫБРАТЬ КОЛОДУ ДЛЯ ИГРЫ", "CHOOSE A DECK TO PLAY"), "invalid selection explains editor route")
    ui.find_child("PlayAI", true, false).pressed.emit()
    await settle()
    check(not ui.battle and ui.find_child("CollectionScreen", true, false) != null, "invalid deck cannot enter battle silently")
    ui.start_tutorial()
    await settle()
    check(ui.tutorial and ui.battle, "tutorial remains available without complete personal deck")
    ui.show_menu()
    ui.queue_free()
    await settle()
    if failures == 0:
        for name in ["a.json","b.json"]:
            DirAccess.remove_absolute(directory.path_join(name))
        DirAccess.remove_absolute(directory)
        print("MULTIMENTAL_USABILITY_PASS checks=" + str(checks) + " layouts=10 actual_android_dp=false")
    quit(0 if failures == 0 else 1)
