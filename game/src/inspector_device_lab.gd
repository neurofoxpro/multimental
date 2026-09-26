extends "res://src/collection_device_lab.gd"
## Reuse the isolated controller and measured OS-tap protocol, not a new test transport.
func _ready() -> void:
    test_name = "real_card_inspector"
    fixture_cards_added = 0
    super._ready()

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
    var fixture = Controller.new()
    fixture.storage = Store.new("user://profile-tests/device-inspector-" + nonce)
    fixture.legacy_settings = ""
    if not fixture.open_profile():
        _finish("fixture_open_failed")
        return
    ui.profile = fixture
    ui.show_menu()
    if not await _tap(ui.find_child("OpenCollection", true, false), "waiting_inspector_collection", func(): return ui.find_child("CollectionScreen", true, false) != null):
        _finish("collection_entry_failed")
        return
    var editor = ui.find_child("CollectionScreen", true, false)
    var initial: Dictionary = fixture.state().duplicate(true)
    editor.change_card("c000", -1)
    var draft: Array = editor.draft_cards.duplicate()
    var source: Button = editor.find_child("Details_c000", true, false)
    editor.scroll.ensure_control_visible(source)
    if not await _tap(source, "waiting_inspector_open", func(): return editor.inspector.visible and editor.inspector.current_id == 0):
        _finish("details_open_failed")
        return
    var close_size: Vector2 = editor.inspector.get_ok_button().size
    var sized: bool = close_size.x >= 260 and close_size.y >= 96
    checks.append({"name": "laid_out_close_target", "ok": sized})
    if not sized:
        _finish("close_target_shrunk")
        return
    if not await _tap(editor.inspector.get_ok_button(), "waiting_inspector_close", func(): return not editor.inspector.visible):
        _finish("details_close_failed")
        return
    var unchanged: bool = fixture.state() == initial and editor.draft_cards == draft and editor.is_dirty()
    checks.append({"name": "reading_preserves_unsaved_draft", "ok": unchanged})
    if not unchanged:
        _finish("details_mutated_profile")
        return
    ui.show_menu()
    var craft_entry: Button = ui.find_child("OpenCrafting", true, false)
    var parent: Node = ui.root.get_parent()
    if parent is ScrollContainer:
        parent.ensure_control_visible(craft_entry)
    if not await _tap(craft_entry, "waiting_inspector_crafting", func(): return ui.find_child("CraftingScreen", true, false) != null):
        _finish("craft_entry_failed")
        return
    var screen = ui.find_child("CraftingScreen", true, false)
    screen.picker.select(21)
    screen.refresh()
    screen.get_parent().ensure_control_visible(screen.details_button)
    if not await _tap(screen.details_button, "waiting_inspector_craft_open", func(): return screen.inspector.visible and screen.inspector.current_id == 21):
        _finish("craft_details_failed")
        return
    if not await _tap(screen.inspector.get_ok_button(), "waiting_inspector_craft_close", func(): return not screen.inspector.visible):
        _finish("craft_details_close_failed")
        return
    var no_spend: bool = fixture.state() == initial and screen.pending.is_empty() and screen.requested.is_empty()
    checks.append({"name": "reading_never_crafts_or_spends", "ok": no_spend})
    if not no_spend:
        _finish("unexpected_economy_write")
        return
    _finish()
