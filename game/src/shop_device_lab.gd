extends "res://src/collection_device_lab.gd"
## Reuses the existing isolated UI fixture and real Android tap handshake.
func _ready() -> void:
    test_name = "real_shop_purchase"
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
    var directory: String = "user://profile-tests/device-shop-" + nonce
    var fixture = Controller.new()
    fixture.storage = Store.new(directory)
    fixture.legacy_settings = ""
    if not fixture.open_profile():
        _finish("fixture_open_failed")
        return
    ui.profile = fixture
    ui.show_menu()
    if not await _tap(ui.find_child("OpenShop", true, false), "waiting_shop_open", func(): return ui.find_child("ShopScreen", true, false) != null):
        _finish("shop_open_tap_failed")
        return
    var shop = ui.find_child("ShopScreen", true, false)
    if not await _tap(shop.buy, "waiting_shop_buy", func(): return int(fixture.state().get("economy", {}).get("packs", 0)) == 1):
        _finish("shop_purchase_tap_failed")
        return
    var expected: Dictionary = fixture.state().economy.lastPack
    var paid: bool = fixture.state().wallet.gold == 400 and fixture.state().wallet.dust == 50 and expected.cards.size() == 5
    checks.append({"name": "five_results_and_single_payment", "ok": paid})
    if not paid:
        _finish("purchase_state_mismatch")
        return
    if not await _tap(shop.find_child("ShopBack", true, false), "waiting_shop_back", func(): return ui.find_child("ShopScreen", true, false) == null):
        _finish("shop_back_tap_failed")
        return
    if not await _tap(ui.find_child("OpenShop", true, false), "waiting_shop_reopen", func(): return ui.find_child("ShopScreen", true, false) != null):
        _finish("shop_reopen_tap_failed")
        return
    var reread = Store.new(directory)
    var restored: bool = reread.open_store("").ok and reread.data.economy.lastPack == expected and reread.data.wallet.gold == 400 and reread.data.economy.packs == 1
    checks.append({"name": "purchase_receipt_reopened_without_double_grant", "ok": restored})
    _finish("" if restored else "reopened_shop_mismatch")
