extends SceneTree
const Model = preload("res://src/profile_state.gd")
const Economy = preload("res://src/economy_rules.gd")
const Journal = preload("res://src/profile_journal.gd")
const Store = preload("res://src/profile_store.gd")
const Controller = preload("res://src/profile_controller.gd")
var checks: int = 0
var failures: int = 0
class LostAckStore extends Store:
    var lose: bool = false
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
        print("ECONOMY_FAIL " + message)
func _initialize() -> void:
    var fresh: Dictionary = Model.fresh("economy-tests")
    check(Model.valid(fresh), "old profiles remain valid")
    var initial: Dictionary = Journal.apply_ordered(fresh, 1, {"kind": "collection_init"}).profile
    var opened: Dictionary = Journal.apply_ordered(initial, 2, {"kind": "economy_init"})
    check(opened.ok and opened.profile.wallet.gold == 500 and not initial.has("economy"), "grant is separate and immutable")
    var p: Dictionary = opened.profile
    check(Journal.apply_ordered(p, 2, {"kind": "economy_init"}).duplicate, "same grant sequence deduplicates")
    var again: Dictionary = Journal.apply_ordered(p, 3, {"kind": "economy_init"})
    check(again.ok and again.profile.wallet.gold == 500, "new grant request cannot farm money")
    var command: Dictionary = {"kind": "pack_buy", "entropy": "fixed pack".sha256_text()}
    var cards: Array[String] = Economy.draw(command.entropy)
    check(cards.size() == 5 and cards == Economy.draw(command.entropy), "exactly five deterministic draws")
    var bought: Dictionary = Journal.apply_ordered(p, 3, command)
    check(bought.ok, "purchase accepted")
    if not bought.ok:
        quit(1)
        return
    check(bought.profile.wallet.gold == 400 and bought.profile.wallet.dust == 50, "all existing duplicates become dust together with debit")
    check(bought.profile.inventory == p.inventory and p.wallet.gold == 500, "original collection and input remain unchanged")
    check(bought.profile.economy.lastPack.cards == cards and bought.profile.economy.lastPack.price == 100, "last pack receipt preserves five cards")
    var retry: Dictionary = Journal.apply_ordered(bought.profile, 3, command)
    check(retry.ok and retry.duplicate and retry.profile == bought.profile, "purchase retry gives no second reward")
    check(not Journal.apply_ordered(bought.profile, 3, {"kind": "pack_buy", "entropy": "different".sha256_text()}).ok, "changed entropy conflicts at same sequence")
    p = bought.profile
    for sequence in range(4, 8):
        p = Journal.apply_ordered(p, sequence, {"kind": "pack_buy", "entropy": str(sequence).sha256_text()}).profile
    check(p.wallet.gold == 0 and p.wallet.dust == 250 and p.economy.packs == 5, "five packs consume exactly test grant")
    check(not Journal.apply_ordered(p, 8, command).ok, "insufficient balance rejected")
    for value in [null, false, 123, "", "a".repeat(63), "A".repeat(64), "z".repeat(64)]:
        check(not Economy.entropy_valid(value), "invalid entropy")
    for bad in [{"kind": "pack_buy"}, {"kind": "pack_buy", "entropy": command.entropy, "price": 0}, {"kind": "credit", "amount": 1000}, {"kind": "economy_init", "amount": 5000}]:
        check(not Model.apply(opened.profile, "invalid", bad).ok, "untrusted commands cannot set price or balance")
    var missing: Dictionary = opened.profile.duplicate(true)
    missing.decks = {}
    missing.collection.names = {}
    missing.collection.selected = ""
    missing.inventory = {}
    var with_cards: Dictionary = Model.apply(missing, "new-cards", command)
    check(with_cards.ok and with_cards.profile.inventory.size() > 0, "unowned draws enter inventory")
    var gained: int = 0
    for key in with_cards.profile.inventory:
        gained += int(with_cards.profile.inventory[key])
    check(gained + int(with_cards.profile.wallet.dust) / 10 == 5, "every draw is one card or dust, never lost")
    var limit: Dictionary = opened.profile.duplicate(true)
    limit.wallet.dust = Model.LIMIT
    check(not Model.apply(limit, "overflow", command).ok and limit.wallet.gold == 500, "overflow cannot partially debit")
    var unknown: Dictionary = p.duplicate(true)
    unknown.economy.version = 2
    check(not Model.valid(unknown), "unsupported economy rejected")
    unknown = p.duplicate(true)
    unknown.economy.lastPack.cards = ["c999"]
    check(not Model.valid(unknown), "corrupt pack receipt rejected")
    var normalized: Variant = JSON.parse_string(JSON.stringify(bought.profile))
    check(Journal.valid(normalized) and Journal.apply_ordered(normalized, 3, command).duplicate, "JSON disk roundtrip retains transaction")
    var frequency: Dictionary = {}
    for seed in range(400):
        var sample: Array[String] = Economy.draw(("sample-" + str(seed)).sha256_text())
        check(sample.size() == 5, "sample has five results")
        for code in sample:
            frequency[code] = int(frequency.get(code, 0)) + 1
    check(frequency.size() == 30, "deterministic corpus reaches every card")
    for count in frequency.values():
        check(int(count) >= 30 and int(count) <= 110, "broad distribution sanity, not certified randomness")
    var directory: String = "user://profile-tests/shop-" + Crypto.new().generate_random_bytes(10).hex_encode()
    var storage = LostAckStore.new(directory)
    check(storage.open_store("").ok, "open isolated disk")
    var controller = Controller.new()
    controller.storage = storage
    controller.legacy_settings = ""
    check(controller.commit({"kind": "collection_init"}) and controller.commit({"kind": "economy_init"}), "initialize through existing controller")
    storage.lose = true
    check(not controller.commit(command) and not controller.pending.is_empty(), "lost acknowledgement is pending, not success")
    check(controller.commit(command), "same pending purchase reconciles")
    check(controller.state().wallet.gold == 400 and controller.state().economy.packs == 1, "no second purchase after lost ack")
    var reopened = Store.new(directory)
    check(reopened.open_store("").ok and reopened.data.economy.lastPack.cards == cards and reopened.data.wallet.dust == 50, "receipt and wallet survive restart")
    var saved: String = FileAccess.get_file_as_string(directory.path_join("b.json"))
    var future: Dictionary = reopened.snapshot()
    future.revision = int(future.revision) + 1
    future.economy.version = 2
    var payload: String = JSON.stringify(future)
    var file := FileAccess.open(directory.path_join("b.json"), FileAccess.WRITE)
    file.store_string(JSON.stringify({"format": 1, "payload": payload, "sha256": payload.sha256_text()}))
    file.close()
    check(not Store.new(directory).open_store("").ok, "future version cannot fall back and silently erase economy")
    if failures == 0:
        for name in ["a.json", "b.json"]:
            DirAccess.remove_absolute(directory.path_join(name))
        DirAccess.remove_absolute(directory)
        print("MULTIMENTAL_ECONOMY_PASS checks=" + str(checks) + " draws=2000")
    quit(0 if failures == 0 else 1)
