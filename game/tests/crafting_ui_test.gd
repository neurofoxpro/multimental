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
func check(ok: bool, text: String) -> void:
    checks += 1
    if not ok:
        failures += 1
        print("CRAFT_UI_FAIL " + text)
func _initialize() -> void:
    call_deferred("run_test")
func run_test() -> void:
    var directory: String = "user://profile-tests/crafting-ui-" + Crypto.new().generate_random_bytes(10).hex_encode()
    var ui = load("res://src/main.tscn").instantiate()
    ui.profile_directory = directory
    ui.profile_legacy_settings = ""
    root.add_child(ui)
    ui.set_process(false)
    await process_frame
    check(not ui.profile.state().has("crafting"), "menu grants no crafting outcome")
    ui.find_child("OpenCrafting", true, false).pressed.emit()
    await process_frame
    var screen = ui.find_child("CraftingScreen", true, false)
    check(screen != null and screen.craft_button.disabled and not screen.recycle_button.disabled, "owned copies shown and spare available")
    var inventory: Dictionary = ui.profile.state().inventory
    var decks: Dictionary = ui.profile.state().decks
    screen.recycle_button.pressed.emit()
    check(screen.confirm.visible and ui.profile.state().inventory == inventory, "no destruction before explicit confirmation")
    screen.confirm.canceled.emit()
    screen.confirm.hide()
    check(screen.requested.is_empty() and ui.profile.state().inventory == inventory, "cancel leaves cards untouched")
    screen.recycle_button.pressed.emit()
    screen.confirm.confirmed.emit()
    screen.confirm.hide()
    check(ui.profile.state().inventory.c000 == 1 and ui.profile.state().wallet.dust == 10, "confirmed spare recycled")
    check(screen.recycle_button.disabled and screen.craft_button.disabled, "needed copy protected and poor craft unavailable")
    check(ui.profile.state().decks == decks, "saved decks unchanged")
    check(ui.profile.commit({"kind": "economy_init"}) and ui.profile.commit({"kind": "pack_buy", "entropy": "craft-ui".sha256_text()}), "test funds via real existing shop rules")
    if ui.profile.state().inventory.c000 == 2:
        check(ui.profile.commit({"kind": "card_recycle", "card": "c000"}), "restore a spare-needed fixture after pack draw")
    screen.refresh()
    var before: int = int(ui.profile.state().wallet.dust)
    ui.profile.storage = LostAckStore.new(directory)
    check(ui.profile.open_profile(), "lost reply fixture opened")
    screen.craft_button.pressed.emit()
    check(not screen.pending.is_empty() and screen.picker.disabled and not screen.craft_button.disabled, "pending outcome retains same operation and offers retry")
    screen.craft_button.pressed.emit()
    check(screen.pending.is_empty() and ui.profile.state().inventory.c000 == 2 and ui.profile.state().wallet.dust == before - 40, "retry crafts once")
    var expected: Dictionary = ui.profile.state()
    screen.leave_requested.emit()
    ui.queue_free()
    await process_frame
    ui = load("res://src/main.tscn").instantiate()
    ui.profile_directory = directory
    ui.profile_legacy_settings = ""
    root.add_child(ui)
    ui.set_process(false)
    ui.show_crafting()
    screen = ui.find_child("CraftingScreen", true, false)
    check(ui.profile.state().inventory == expected.inventory and ui.profile.state().wallet == expected.wallet, "reopen exact cards and balance")
    for locale in ["ru", "en"]:
        ui.language = locale
        for viewport in [Vector2i(720, 1280), Vector2i(720, 1440), Vector2i(1280, 720)]:
            root.content_scale_size = viewport
            root.size = viewport
            ui.show_crafting()
            await process_frame
            await process_frame
            screen = ui.find_child("CraftingScreen", true, false)
            var scroll: ScrollContainer = screen.get_parent()
            for control in [screen.picker, screen.craft_button, screen.recycle_button, screen.find_child("CraftBack", true, false)]:
                scroll.ensure_control_visible(control)
                await process_frame
                await process_frame
                check(ui.get_viewport_rect().encloses(control.get_global_rect()), "critical crafting action reachable")
    var a: String = FileAccess.get_sha256(directory.path_join("a.json"))
    var b: String = FileAccess.get_sha256(directory.path_join("b.json"))
    ui.profile.enabled = false
    ui.show_crafting()
    check(ui.find_child("CraftingScreen", true, false) == null, "diagnostic cannot change personal collection")
    check(FileAccess.get_sha256(directory.path_join("a.json")) == a and FileAccess.get_sha256(directory.path_join("b.json")) == b, "disabled profile unchanged")
    ui.queue_free()
    await process_frame
    if failures == 0:
        for file in ["a.json", "b.json"]:
            DirAccess.remove_absolute(directory.path_join(file))
        DirAccess.remove_absolute(directory)
        print("MULTIMENTAL_CRAFT_UI_PASS checks=" + str(checks))
    quit(0 if failures == 0 else 1)
