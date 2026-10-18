extends "res://src/collection_device_lab.gd"
## Same isolated-fixture and OS-tap contract; never alters personal cards.
func _ready() -> void:
    test_name = "real_card_crafting"
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
    var directory: String = "user://profile-tests/device-craft-" + nonce
    var fixture = Controller.new()
    fixture.storage = Store.new(directory)
    fixture.legacy_settings = ""
    if not fixture.open_profile() or not fixture.commit({"kind": "collection_init"}) or not fixture.commit({"kind": "economy_init"}) or not fixture.commit({"kind": "pack_buy", "entropy": nonce.sha256_text()}):
        _finish("fixture_funding_failed")
        return
    ui.profile = fixture
    ui.show_menu()
    if not await _tap(ui.find_child("OpenCrafting", true, false), "waiting_craft_open", func(): return ui.find_child("CraftingScreen", true, false) != null):
        _finish("open_craft_failed")
        return
    var screen = ui.find_child("CraftingScreen", true, false)
    var decks: Dictionary = fixture.state().decks
    if not await _tap(screen.recycle_button, "waiting_craft_recycle", func(): return screen.confirm.visible):
        _finish("recycle_prompt_failed")
        return
    checks.append({"name": "no_recycle_before_confirmation", "ok": fixture.state().inventory.c000 == 2})
    if not await _tap(screen.confirm.get_ok_button(), "waiting_craft_confirm", func(): return fixture.state().inventory.c000 == 1):
        _finish("recycle_confirmation_failed")
        return
    checks.append({"name": "required_last_copy_protected", "ok": screen.recycle_button.disabled and fixture.state().wallet.dust == 60})
    if not await _tap(screen.craft_button, "waiting_craft_create", func(): return fixture.state().inventory.c000 == 2):
        _finish("craft_tap_failed")
        return
    var reread = Store.new(directory)
    var restored: bool = reread.open_store("").ok and reread.data.inventory.c000 == 2 and reread.data.wallet.dust == 20 and reread.data.decks == decks and reread.data.crafting.crafted == 1 and reread.data.crafting.recycled == 1
    checks.append({"name": "one_craft_one_recycle_reopened", "ok": restored})
    if not restored:
        _finish("craft_receipt_mismatch")
        return
    var back: Button = screen.find_child("CraftBack", true, false)
    screen.get_parent().ensure_control_visible(back)
    if not await _tap(back, "waiting_craft_back", func(): return ui.find_child("CraftingScreen", true, false) == null):
        _finish("craft_back_failed")
        return
    _finish()
