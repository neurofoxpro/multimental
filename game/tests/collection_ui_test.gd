extends SceneTree
const Store = preload("res://src/profile_store.gd")
const Core = preload("res://src/match_core.gd")
var checks: int = 0
var failures: int = 0
class LostAckStore extends Store:
    var fail_once: bool = true
    func _write_slot(filename: String, text: String) -> Error:
        var result: Error = super._write_slot(filename, text)
        if fail_once and result == OK:
            fail_once = false
            return ERR_FILE_CANT_WRITE
        return result
func check(value: bool, title: String) -> void:
    checks += 1
    if not value:
        failures += 1
        print("COLLECTION_UI_FAIL " + title)
func _initialize() -> void:
    call_deferred("run_test")
func make_ui(directory: String):
    var ui = load("res://src/main.tscn").instantiate()
    ui.profile_directory = directory
    ui.profile_legacy_settings = ""
    root.add_child(ui)
    ui.set_process(false)
    return ui
func run_test() -> void:
    root.size = Vector2i(720, 1280)
    var directory: String = "user://profile-tests/editor-" + Crypto.new().generate_random_bytes(12).hex_encode()
    var ui = make_ui(directory)
    await process_frame
    check(not ui.profile.state().has("collection"), "normal launch does not silently grant cards")
    ui.start_tutorial()
    check(ui.battle and ui.tutorial and not ui.profile.state().has("collection"), "tutorial starts before collection initialization")
    ui.show_menu()
    ui.find_child("OpenCollection", true, false).pressed.emit()
    await process_frame
    var editor = ui.find_child("CollectionScreen", true, false)
    check(editor != null, "menu opens real editor")
    if editor == null:
        quit(1)
        return
    check(editor.rows.get_child_count() == 30, "catalog contains 30 cards")
    check(ui.profile.state().inventory.c000 == 2 and editor.draft_cards.size() == 15, "first open creates bounded starter collection")
    var first_revision: int = int(ui.profile.state().revision)
    ui.show_collection()
    editor = ui.find_child("CollectionScreen", true, false)
    check(ui.profile.state().revision == first_revision, "repeated open does not repeat grant")
    editor.search.text = "fire"
    editor.search.text_changed.emit("fire")
    check(editor.rows.get_child_count() == 3, "English search in Russian UI")
    editor.search.text = "молния"
    editor.search.text_changed.emit("молния")
    check(editor.rows.get_child_count() == 3, "Russian search")
    editor.search.text = ""
    editor.elements.select(2)
    editor.elements.item_selected.emit(2)
    check(editor.rows.get_child_count() == 3, "element filter")
    editor.elements.select(0)
    editor.elements.item_selected.emit(0)
    editor.new_button.pressed.emit()
    var deck_id: String = editor.draft_id
    check(not editor.existing and editor.draft_cards.is_empty(), "new deck is a local draft")
    editor.name_input.text = "Молния / Lightning"
    editor.name_input.text_changed.emit(editor.name_input.text)
    editor.change_card("c015", 1)
    editor.change_card("c015", 1)
    editor.change_card("c015", 1)
    check(editor.draft_cards.size() == 2, "third copy refused by UI")
    editor.change_card("c015", -1)
    for id in range(16, 30):
        editor.change_card("c%03d" % id, 1)
    check(editor.draft_cards.size() == 15 and editor.choose_button.disabled, "complete but unsaved deck cannot be selected")
    var expected: Array = editor.draft_cards.duplicate()
    editor.save_button.pressed.emit()
    check(editor.existing and not editor.is_dirty() and ui.profile.state().decks[deck_id] == expected, "save button commits named deck")
    editor.choose_button.pressed.emit()
    check(ui.profile.state().collection.selected == deck_id and not editor.play_button.disabled, "select button enables real match")
    editor.play_button.pressed.emit()
    check(ui.battle and ui.game.initial_decks[0][0] == 15, "ordinary match uses chosen deck")
    ui.game.start_with_decks(42, ui.game.initial_decks)
    for index in range(600):
        if ui.game.state.winner != -1:
            break
        ui.game.apply(int(ui.game.state.active), ui.game.choose_ai())
    ui.after_action()
    check(ui.result_saved and ui.profile.state().stats.matches == 1, "custom match result saved")
    var replay: Dictionary = ui.profile.state().lastMatch.replay
    var commands: Array[Dictionary] = []
    commands.assign(replay.commands)
    var replayed = Core.new()
    replayed.replay(int(replay.seed), commands, replay.decks)
    check(replayed.digest() == ui.game.digest(), "ordinary custom match replays exactly")
    ui.show_menu()
    ui.queue_free()
    await process_frame
    ui = make_ui(directory)
    ui.show_collection()
    editor = ui.find_child("CollectionScreen", true, false)
    check(editor.draft_id == deck_id and editor.draft_cards == expected, "restart restores selected deck and names")
    editor.change_card("c015", -1)
    editor.request_new()
    check(editor.confirmation.visible and editor.draft_id == deck_id, "unsaved changes require explicit discard")
    editor.confirmation.canceled.emit()
    editor.confirmation.hide()
    check(editor.draft_cards.size() == 14, "cancel keeps unsaved cards")
    editor.save_button.pressed.emit()
    check(ui.profile.state().collection.selected == "" and editor.play_button.disabled, "incomplete saved draft cannot start")
    ui.start_match()
    check(not ui.battle and ui.find_child("CollectionScreen", true, false) != null, "no silent starter fallback for incomplete selection")
    ui.start_tutorial()
    check(ui.battle and ui.tutorial and ui.game.initial_decks[0] == Core.STARTER, "tutorial works with incomplete personal deck")
    check(ui.profile.state().collection.selected == "", "tutorial does not change personal selection")
    ui.show_collection()
    editor = ui.find_child("CollectionScreen", true, false)
    editor.load_deck(deck_id)
    editor.change_card("c015", 1)
    ui.profile.storage = LostAckStore.new(directory)
    check(ui.profile.open_profile(), "reopen for lost acknowledgment test")
    check(not editor.save_deck() and editor.is_dirty(), "failed save keeps visible draft")
    check(editor.save_deck() and not editor.is_dirty(), "retry reconciles save without duplication")
    editor.select_deck()
    editor.name_input.text = "x".repeat(48)
    editor.name_input.text_changed.emit(editor.name_input.text)
    check(editor.save_deck(), "long legal name saved")
    await process_frame
    await process_frame
    var viewport: Rect2 = ui.get_viewport_rect()
    for control in [editor, editor.picker, editor.save_button, editor.play_button, editor.scroll]:
        check(viewport.encloses(control.get_global_rect()), "portrait bounds " + str(control.name))
    for viewport_size in [Vector2i(720, 1440), Vector2i(1280, 720)]:
        root.size = viewport_size
        await process_frame
        await process_frame
        for control in [editor.picker, editor.play_button, editor.save_button]:
            check(ui.get_viewport_rect().encloses(control.get_global_rect()), "resized bounds " + str(control.name))
    root.size = Vector2i(720, 1280)
    await process_frame
    editor.request_delete()
    check(editor.confirmation.visible, "deletion asks confirmation")
    editor.confirmation.hide()
    editor._confirmed()
    check(not ui.profile.state().decks.has(deck_id) and ui.profile.state().inventory.c015 == 2, "deletion keeps all collection cards")
    ui.language = "en"
    ui.show_collection()
    editor = ui.find_child("CollectionScreen", true, false)
    check(editor.play_button.text.contains("PLAY"), "English screen")
    editor.name_input.text = "   "
    editor.name_input.text_changed.emit(editor.name_input.text)
    check(editor.save_button.disabled, "empty name cannot be saved")
    ui.queue_free()
    await process_frame
    if failures == 0:
        for filename in ["a.json", "b.json"]:
            DirAccess.remove_absolute(directory.path_join(filename))
        DirAccess.remove_absolute(directory)
        print("MULTIMENTAL_COLLECTION_UI_PASS checks=" + str(checks))
    quit(0 if failures == 0 else 1)
