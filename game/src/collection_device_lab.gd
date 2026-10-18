extends Node
## Debug-only UI fixture: real OS taps, isolated profile, no personal rewards.
signal changed(values: Dictionary)
signal completed(values: Dictionary)
const Controller = preload("res://src/profile_controller.gd")
const Store = preload("res://src/profile_store.gd")
var ui
var nonce: String = ""
var original
var original_processing: bool = true
var before: Array[String] = []
var checks: Array[Dictionary] = []
var done: bool = false
var test_name: String = "real_collection_editor"
var fixture_cards_added: int = 13
func _ready() -> void:
    call_deferred("run_lab")
func personal_hashes() -> Array[String]:
    var result: Array[String] = []
    for name in ["a.json", "b.json"]:
        var file: String = "user://profile/" + name
        result.append(FileAccess.get_sha256(file) if FileAccess.file_exists(file) else "")
    return result
func _finish(reason: String = "") -> void:
    if done:
        return
    done = true
    if original != null:
        ui.battle = false
        ui.online = false
        ui.profile = original
        ui.show_menu()
        ui.set_process(original_processing)
    var preserved: bool = personal_hashes() == before
    completed.emit({"status": "passed" if reason == "" and preserved else "failed", "error": reason, "test": test_name, "checks": checks, "personal_profile_untouched": preserved, "input_source": "external_android_input_tap", "fixture_cards_added_by_api": fixture_cards_added, "version": BuildInfo.VERSION})
func _tap(control: Control, stage: String, predicate: Callable) -> bool:
    await get_tree().process_frame
    await get_tree().process_frame
    if not is_instance_valid(control) or not control.is_visible_in_tree():
        return false
    if control is BaseButton and control.disabled:
        return false
    var geometry: Dictionary = preload("res://src/ui_tap_geometry.gd").target(control, ui.get_viewport())
    if not geometry.ok:
        return false
    changed.emit({"stage": stage, "tap": geometry.tap, "tapGeometry": geometry})
    var until: int = Time.get_ticks_msec() + 20000
    while Time.get_ticks_msec() < until and not predicate.call():
        await get_tree().create_timer(0.05).timeout
    var passed: bool = bool(predicate.call())
    checks.append({"name": stage, "ok": passed})
    return passed
func run_lab() -> void:
    before = personal_hashes()
    if not OS.is_debug_build() or nonce.length() != 48:
        _finish("invalid_debug_request")
        return
    for letter in nonce:
        if not letter in "0123456789abcdef":
            _finish("invalid_nonce")
            return
    original = ui.profile
    original_processing = ui.is_processing()
    ui.set_process(false)
    var directory: String = "user://profile-tests/device-editor-" + nonce
    var fixture = Controller.new()
    fixture.storage = Store.new(directory)
    fixture.legacy_settings = ""
    if not fixture.open_profile():
        _finish("fixture_open_failed")
        return
    ui.profile = fixture
    ui.show_collection()
    await get_tree().process_frame
    var editor = ui.find_child("CollectionScreen", true, false)
    if editor == null:
        _finish("editor_missing")
        return
    if not await _tap(editor.new_button, "waiting_collection_new", func(): return not editor.existing and editor.draft_cards.is_empty()):
        _finish("new_deck_tap_failed")
        return
    for id in range(15, 28):
        editor.change_card("c%03d" % id, 1)
    editor.scroll.scroll_vertical = 0
    if not await _tap(editor.find_child("Add_c000", true, false), "waiting_collection_add", func(): return editor.draft_cards.size() == 14):
        _finish("add_tap_failed")
        return
    if not await _tap(editor.find_child("Remove_c000", true, false), "waiting_collection_remove", func(): return editor.draft_cards.size() == 13):
        _finish("remove_tap_failed")
        return
    if not await _tap(editor.find_child("Add_c000", true, false), "waiting_collection_add_again", func(): return editor.draft_cards.size() == 14):
        _finish("second_add_failed")
        return
    if not await _tap(editor.find_child("Add_c000", true, false), "waiting_collection_complete", func(): return editor.draft_cards.size() == 15):
        _finish("complete_tap_failed")
        return
    var deck_id: String = editor.draft_id
    var expected: Array = editor.draft_cards.duplicate()
    if not await _tap(editor.save_button, "waiting_collection_save", func(): return editor.existing and not editor.is_dirty()):
        _finish("save_tap_failed")
        return
    if not await _tap(editor.choose_button, "waiting_collection_select", func(): return fixture.state().collection.selected == deck_id):
        _finish("select_tap_failed")
        return
    var reread = Store.new(directory)
    var restored: bool = reread.open_store("").ok and reread.data.decks.get(deck_id) == expected and reread.data.collection.selected == deck_id
    checks.append({"name": "saved_selection_reopened", "ok": restored})
    if not restored:
        _finish("disk_selection_mismatch")
        return
    if not await _tap(editor.play_button, "waiting_collection_play", func(): return ui.battle):
        _finish("play_tap_failed")
        return
    var selected: bool = ui.game.initial_decks[0] == range(15, 28) + [0, 0]
    checks.append({"name": "actual_match_uses_selected_deck", "ok": selected})
    _finish("" if selected else "wrong_match_composition")
