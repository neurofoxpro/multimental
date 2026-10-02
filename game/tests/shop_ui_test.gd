extends SceneTree
const Store = preload("res://src/profile_store.gd")
var checks: int = 0
var failures: int = 0
class LostAckStore extends Store:
    var lose: bool = true
    func _write_slot(filename: String, text: String) -> Error:
        var result: Error = super._write_slot(filename, text)
        if lose and result == OK:
            lose = false
            return ERR_FILE_CANT_WRITE
        return result
func check(value: bool, message: String) -> void:
    checks += 1
    if not value:
        failures += 1
        print("SHOP_UI_FAIL " + message)
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
    var directory: String = "user://profile-tests/shop-ui-" + Crypto.new().generate_random_bytes(10).hex_encode()
    root.size = Vector2i(720, 1280)
    var ui = make_ui(directory)
    await process_frame
    check(not ui.profile.state().has("economy"), "menu does not secretly grant currency")
    var open_button: Button = ui.find_child("OpenShop", true, false)
    check(open_button != null, "shop entry exists")
    open_button.pressed.emit()
    await process_frame
    await process_frame
    var shop = ui.find_child("ShopScreen", true, false)
    check(shop != null and ui.profile.state().wallet.gold == 500, "explicit entry initializes test budget")
    check(not shop.buy.disabled, "purchase enabled for funded profile")
    var inventory_before: Dictionary = ui.profile.state().inventory
    shop.buy.pressed.emit()
    check(ui.profile.state().wallet.gold == 400 and ui.profile.state().wallet.dust == 50, "UI purchase debits and credits together")
    check(ui.profile.state().inventory == inventory_before, "existing alpha collection not taken away")
    var receipt: Dictionary = ui.profile.state().economy.lastPack
    check(receipt.cards.size() == 5 and shop.purchase.is_empty(), "UI displays committed five-card receipt")
    var card_rows: int = 0
    for child in shop.results.get_children():
        if str(child.name).begins_with("PackCard"):
            card_rows += 1
    check(card_rows == 5, "exactly five result rows")
    shop.leave_requested.emit()
    ui.show_shop()
    shop = ui.find_child("ShopScreen", true, false)
    check(ui.profile.state().wallet.gold == 400 and ui.profile.state().economy.packs == 1, "reopening cannot repeat grant or purchase")
    ui.profile.storage = LostAckStore.new(directory)
    check(ui.profile.open_profile(), "reopen with lost-ack fixture")
    shop.buy.pressed.emit()
    check(not shop.purchase.is_empty() and not ui.profile.pending.is_empty(), "failed acknowledgement retains original purchase command")
    var pending: Dictionary = shop.purchase.duplicate(true)
    check(not shop.buy.disabled and shop.buy.text.contains("ПОВТОР"), "same-operation retry visible")
    shop.buy.pressed.emit()
    check(shop.purchase.is_empty() and ui.profile.pending.is_empty(), "retry reconciles completed disk operation")
    check(ui.profile.state().economy.packs == 2 and ui.profile.state().wallet.gold == 300, "retry never opens a third pack")
    check(ui.profile.state().economy.lastPack.cards == preload("res://src/economy_rules.gd").draw(pending.entropy), "recovery uses original entropy")
    for index in range(3):
        shop.buy.pressed.emit()
    check(shop.buy.disabled and ui.profile.state().wallet.gold == 0 and ui.profile.state().economy.packs == 5, "budget exhausted after five actual packs")
    var revision: int = int(ui.profile.state().revision)
    shop.purchase_pack()
    check(int(ui.profile.state().revision) == revision, "unfunded press cannot write or debit")
    ui.show_menu()
    ui.queue_free()
    await process_frame
    ui = make_ui(directory)
    ui.show_shop()
    shop = ui.find_child("ShopScreen", true, false)
    check(ui.profile.state().wallet.gold == 0 and ui.profile.state().economy.packs == 5, "restart preserves budget and pack receipt")
    check(ui.profile.state().stats.matches == 0, "shop tests do not farm match statistics")
    for language in ["ru", "en"]:
        ui.language = language
        for size in [Vector2i(720, 1280), Vector2i(720, 1440), Vector2i(1280, 720)]:
            root.size = size
            ui.show_shop()
            await process_frame
            await process_frame
            shop = ui.find_child("ShopScreen", true, false)
            check(ui.get_viewport_rect().encloses(shop.buy.get_global_rect()), "purchase target within viewport " + language + str(size))
            var back: Button = shop.find_child("ShopBack", true, false)
            check(ui.get_viewport_rect().encloses(back.get_global_rect()), "back target within viewport " + language + str(size))
    var before_a: String = FileAccess.get_sha256(directory.path_join("a.json"))
    var before_b: String = FileAccess.get_sha256(directory.path_join("b.json"))
    ui.profile.enabled = false
    ui.show_shop()
    check(ui.find_child("ShopScreen", true, false) == null, "personal shop unavailable in diagnostic mode")
    check(FileAccess.get_sha256(directory.path_join("a.json")) == before_a and FileAccess.get_sha256(directory.path_join("b.json")) == before_b, "diagnostic cannot mutate personal profile")
    ui.queue_free()
    await process_frame
    if failures == 0:
        for name in ["a.json", "b.json"]:
            DirAccess.remove_absolute(directory.path_join(name))
        DirAccess.remove_absolute(directory)
        print("MULTIMENTAL_SHOP_UI_PASS checks=" + str(checks))
    quit(0 if failures == 0 else 1)
