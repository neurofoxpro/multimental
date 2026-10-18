extends SceneTree
const Model = preload("res://src/profile_state.gd")
const Craft = preload("res://src/crafting_rules.gd")
const Policy = preload("res://src/crafting_policy.gd")
const Core = preload("res://src/match_core.gd")
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
func check(value: bool, name: String) -> void:
    checks += 1
    if not value:
        failures += 1
        print("CRAFT_FAIL " + name)
func _initialize() -> void:
    var p: Dictionary = Model.apply(Model.fresh("craft-test"), "init", {"kind": "collection_init"}).profile
    p.wallet.dust = 100
    var original: Dictionary = p.duplicate(true)
    check(Craft.required_copies(p, "c000") == 1, "starter requires one copy")
    check(not Craft.quote(p, "c000", "card_craft").ok, "third copy refused")
    var recycled: Dictionary = Model.apply(p, "recycle", {"kind": "card_recycle", "card": "c000"})
    check(recycled.ok and recycled.profile.inventory.c000 == 1 and recycled.profile.wallet.dust == 110, "explicit spare copy recycled")
    check(p == original, "input not mutated")
    p = recycled.profile
    check(Model.apply(p, "recycle", {"kind": "card_recycle", "card": "c000"}).duplicate, "retry not double recycle")
    check(not Model.apply(p, "needed", {"kind": "card_recycle", "card": "c000"}).ok, "last copy used in any deck protected")
    var crafted: Dictionary = Model.apply(p, "craft", {"kind": "card_craft", "card": "c000"})
    check(crafted.ok and crafted.profile.inventory.c000 == 2 and crafted.profile.wallet.dust == 70, "targeted craft and price together")
    check(crafted.profile.decks == p.decks and crafted.profile.collection == p.collection, "deck selection not invalidated")
    check(Model.apply(crafted.profile, "craft", {"kind": "card_craft", "card": "c000"}).duplicate, "craft retry deduplicates")
    check(not Model.apply(crafted.profile, "craft", {"kind": "card_recycle", "card": "c000"}).ok, "transaction ID conflict")
    var poor: Dictionary = p.duplicate(true)
    poor.wallet.dust = 0
    check(not Model.apply(poor, "poor", {"kind": "card_craft", "card": "c000"}).ok and poor.inventory.c000 == 1, "no partial craft without dust")
    for bad in [{"kind": "card_craft", "card": "c999"}, {"kind": "card_craft", "card": 0}, {"kind": "card_craft", "card": "c000", "price": 0}, {"kind": "card_recycle"}]:
        check(not Model.apply(p, "bad", bad).ok, "invalid payload refused")
    var protected: Dictionary = original.duplicate(true)
    protected.decks["draft"] = ["c000", "c000"]
    protected.collection.names["draft"] = "Draft"
    check(Model.valid(protected) and not Craft.quote(protected, "c000", "card_recycle").ok, "incomplete drafts also reserve required copies")
    var serialized: Variant = JSON.parse_string(JSON.stringify(crafted.profile))
    check(Model.valid(serialized) and Model.apply(serialized, "craft", {"kind": "card_craft", "card": "c000"}).duplicate, "JSON retry")
    var future: Dictionary = crafted.profile.duplicate(true)
    future.crafting.version = 999
    check(not Model.valid(future), "future crafting invalid")
    var high: Dictionary = original.duplicate(true)
    high.wallet.dust = Model.LIMIT
    check(not Craft.quote(high, "c000", "card_recycle").ok, "dust overflow rejected")
    for id in range(30):
        var code: String = "c%03d" % id
        var before: Dictionary = Core.new().card(id)
        var one: Dictionary = Model.apply(original, "r", {"kind": "card_recycle", "card": code})
        check(one.ok, "each free spare can recycle")
        var two: Dictionary = Model.apply(one.profile, "c", {"kind": "card_craft", "card": code})
        check(two.ok and two.profile.inventory == original.inventory and two.profile.wallet.dust == 70, "cycle cannot create profit")
        check(Core.new().card(id) == before, "craft does not upgrade stats")
    var directory: String = "user://profile-tests/craft-" + Crypto.new().generate_random_bytes(10).hex_encode()
    var controller = Controller.new()
    var disk = LostAckStore.new(directory)
    controller.storage = disk
    controller.legacy_settings = ""
    check(controller.open_profile() and controller.commit({"kind": "collection_init"}), "isolated disk ready")
    check(controller.commit({"kind": "economy_init"}) and controller.commit({"kind": "pack_buy", "entropy": "craft-pack".sha256_text()}), "earn test dust from existing pack")
    var action: Dictionary = {"kind": "card_recycle", "card": "c000"}
    disk.lose = true
    check(not controller.commit(action) and not controller.pending.is_empty(), "lost response retains pending ID")
    check(controller.commit(action) and controller.state().inventory.c000 == 1 and controller.state().wallet.dust == 60, "retry resolves one recycle")
    check(controller.commit({"kind": "card_craft", "card": "c000"}), "craft uses ordered disk transaction")
    var reopened = Store.new(directory)
    check(reopened.open_store("").ok and reopened.data.inventory.c000 == 2 and reopened.data.wallet.dust == 20, "craft persists across reopen")
    check(Policy.COST > Policy.RECYCLE and Policy.RECYCLE > 0, "configuration forbids free craft-recycle profit")
    var future_disk: Dictionary = reopened.snapshot()
    future_disk.revision = int(future_disk.revision) + 1
    future_disk.crafting.version = 2
    var payload: String = JSON.stringify(future_disk)
    var file := FileAccess.open(directory.path_join("b.json"), FileAccess.WRITE)
    file.store_string(JSON.stringify({"format": 1, "payload": payload, "sha256": payload.sha256_text()}))
    file.close()
    var future_hash: String = FileAccess.get_sha256(directory.path_join("b.json"))
    check(not Store.new(directory).open_store("").ok, "unsupported craft version does not restore older state over future data")
    check(FileAccess.get_sha256(directory.path_join("b.json")) == future_hash, "future save left byte-exact")
    if failures == 0:
        for name in ["a.json", "b.json"]:
            DirAccess.remove_absolute(directory.path_join(name))
        DirAccess.remove_absolute(directory)
        print("MULTIMENTAL_CRAFT_PASS checks=" + str(checks))
    quit(0 if failures == 0 else 1)
