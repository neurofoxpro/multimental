extends SceneTree
const Deck = preload("res://src/deck_rules.gd")
const Model = preload("res://src/profile_state.gd")
const Collection = preload("res://src/collection_rules.gd")
const Store = preload("res://src/profile_store.gd")
const Core = preload("res://src/match_core.gd")
var checks: int = 0
var failures: int = 0
func check(value: bool, name: String) -> void:
    checks += 1
    if not value:
        failures += 1
        print("COLLECTION_FAIL " + name)
func _initialize() -> void:
    check(Deck.CARD_COUNT == Core.CARD_COUNT, "catalog size contract")
    check(Deck.validate_ids(Deck.STARTER).ok, "starter valid")
    for id in range(Deck.CARD_COUNT):
        check(Deck.card_id(Deck.code(id)) == id, "stable code roundtrip")
    for bad in ["c030", "c-01", "c0", "C000", "cabc", "c00a", 0, true, null, "../c000"]:
        check(Deck.card_id(bad) == -1, "invalid stable code")
    for bad in [[], [0], "deck", null, {}, [true], [1.5], [-1], [INF], [NAN]]:
        check(not Deck.validate_ids(bad).ok, "invalid playable deck")
    check(Deck.validate_codes([], {}, true).ok, "empty draft allowed")
    var excess: Array = Deck.STARTER.duplicate()
    excess[0] = 0
    excess[1] = 0
    excess[2] = 0
    check(not Deck.validate_ids(excess).ok, "three copies refused")
    var original: Dictionary = Model.fresh("test-collection")
    var initialized: Dictionary = Model.apply(original, "init", {"kind": "collection_init"})
    check(initialized.ok and original.inventory.is_empty(), "grant without mutating input")
    if not initialized.ok:
        var diagnostic: Dictionary = Collection.apply(original, {"kind": "collection_init"})
        print("COLLECTION_INIT_DIAGNOSTIC " + JSON.stringify({"result": initialized, "raw": diagnostic, "selected": Deck.validate_codes(diagnostic.profile.decks.starter, diagnostic.profile.inventory)}))
        quit(1)
        return
    var p: Dictionary = initialized.profile
    var catalog = preload("res://src/catalog_view.gd")
    check(catalog.rows(p).size() == 30, "complete read-only catalog")
    check(catalog.rows(p, "искр").size() == 1 and catalog.rows(p, "SPARK").size() == 1, "bilingual case-insensitive search")
    check(catalog.rows(p, "", 0).size() == 3 and catalog.rows(p, "", 9).size() == 3, "all elemental filters")
    check(catalog.rows(p, "", 0)[0].owned == 2, "catalog ownership reflects grant")
    check(p.inventory.size() == 30 and p.inventory.c000 == 2 and Collection.selected(p).ok, "alpha grant and starter")
    check(Model.apply(p, "init-again", {"kind": "collection_init"}).profile.inventory == p.inventory, "no repeated grant")
    check(not Deck.validate_codes(["c000"], {}, true).ok, "ownership required")
    var chosen: Array[String] = []
    for id in range(15, 30):
        chosen.append(Deck.code(id))
    var save: Dictionary = {"kind": "deck_save", "id": "test-deck", "name": "Моя колода", "cards": chosen}
    var saved: Dictionary = Model.apply(p, "save-1", save)
    check(saved.ok and not p.decks.has("test-deck"), "save named deck transactionally")
    p = saved.profile
    check(Model.apply(p, "save-1", save).duplicate, "save retry is idempotent")
    check(not Model.apply(p, "save-1", {"kind": "deck_delete", "id": "starter"}).ok, "transaction conflict")
    p = Model.apply(p, "select", {"kind": "deck_select", "id": "test-deck"}).profile
    check(Collection.selected(p).ids[0] == 15, "selected deck used")
    save.cards = []
    p = Model.apply(p, "draft", save).profile
    check(p.collection.selected == "" and p.decks["test-deck"].is_empty(), "editing to draft removes playable selection")
    check(not Model.apply(p, "invalid-select", {"kind": "deck_select", "id": "test-deck"}).ok, "draft cannot enter match")
    for name in ["", " ", " leading", "bad\nname", "x".repeat(49)]:
        check(not Model.apply(p, "badname", {"kind": "deck_save", "id": "x", "name": name, "cards": []}).ok, "bad name rejected")
    check(Model.valid(JSON.parse_string(JSON.stringify(p))), "collection JSON roundtrip")
    var corrupted: Dictionary = p.duplicate(true)
    corrupted.decks.starter[0] = "c999"
    check(not Model.valid(corrupted), "unknown card invalidates save")
    var legacy: Dictionary = Model.fresh("legacy")
    legacy.inventory.c000 = 1
    check(not Model.apply(legacy, "init", {"kind": "collection_init"}).ok, "unknown nonempty legacy preserved")
    for n in range(Collection.MAX_DECKS - 2):
        var more: Dictionary = Model.apply(p, "deck-" + str(n), {"kind": "deck_save", "id": "extra-" + str(n), "name": "Deck " + str(n), "cards": []})
        check(more.ok, "bounded named decks")
        p = more.profile
    check(not Model.apply(p, "overflow", {"kind": "deck_save", "id": "overflow", "name": "Extra", "cards": []}).ok, "deck count limit")
    check(Model.apply(p, "delete", {"kind": "deck_delete", "id": "starter"}).ok, "delete saved deck")
    var directory: String = "user://profile-tests/collection_" + Crypto.new().generate_random_bytes(10).hex_encode()
    var store = Store.new(directory)
    check(store.open_store("").ok and store.transact(1, {"kind": "collection_init"}).ok, "disk initialization")
    save.cards = chosen
    check(store.transact(2, save).ok and store.transact(3, {"kind": "deck_select", "id": "test-deck"}).ok, "disk save and selection")
    var loaded = Store.new(directory)
    check(loaded.open_store("").ok and Collection.selected(loaded.snapshot()).ids[0] == 15, "restart restores selection")
    check(loaded.transact(3, {"kind": "deck_select", "id": "test-deck"}).duplicate, "disk retry preserves result")
    var left: Array[int] = []
    var right: Array[int] = []
    for id in range(15):
        left.append(id)
        right.append(id + 15)
    for seed in range(1, 41):
        var old = Core.new()
        old.start(seed)
        var game = Core.new()
        check(game.start_with_decks(seed, [Deck.STARTER, Deck.STARTER]).ok and game.digest() == old.digest(), "default seeded behavior unchanged")
        check(game.start_with_decks(seed, [left, right]).ok, "custom match starts")
        var cards: Array = game.state.players[0].hand + game.state.players[0].deck
        cards.sort()
        check(cards == left, "selected cards enter actual match")
        var before: String = game.digest()
        check(not game.start_with_decks(seed, [[], right]).ok and game.digest() == before, "invalid start does not reset a match")
        for step in range(600):
            if game.state.winner != -1:
                break
            game.apply(int(game.state.active), game.choose_ai())
        check(game.state.winner != -1, "custom seeded match terminates")
        var replayed = Core.new()
        var commands: Array[Dictionary] = []
        commands.assign(JSON.parse_string(JSON.stringify(game.commands)))
        replayed.replay(seed, commands, JSON.parse_string(JSON.stringify(game.initial_decks)))
        check(replayed.digest() == game.digest(), "custom JSON replay exact")
    var frozen = Core.new()
    var supplied: Array = [left.duplicate(), right.duplicate()]
    frozen.start_with_decks(42, supplied)
    supplied[0][0] = 29
    check(frozen.initial_decks[0][0] == 0, "match owns an independent deck snapshot")
    var future: Dictionary = loaded.snapshot()
    future.collection.version = 2
    var payload: String = JSON.stringify(future, "", true, true)
    var encoded: String = JSON.stringify({"format": 1, "payload": payload, "sha256": payload.sha256_text()})
    check(loaded._write_slot(directory.path_join("a.json"), encoded) == OK, "future-version fixture written")
    var unsupported = Store.new(directory)
    check(unsupported.open_store("").get("code") == "STORE_UNSUPPORTED", "future collection cannot be overwritten by backup recovery")
    check(FileAccess.get_file_as_string(directory.path_join("a.json")) == encoded, "future data preserved exactly")
    if failures == 0:
        for name in ["a.json", "b.json"]:
            if FileAccess.file_exists(directory.path_join(name)):
                DirAccess.remove_absolute(directory.path_join(name))
        DirAccess.remove_absolute(directory)
        print("MULTIMENTAL_COLLECTION_PASS checks=" + str(checks) + " seeded_matches=40")
    quit(0 if failures == 0 else 1)
