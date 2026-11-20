extends SceneTree
const Status = preload("res://src/home_deck_status.gd")
const Deck = preload("res://src/deck_rules.gd")
var total := 0
var failed := 0

func check(value: bool, why: String) -> void:
    total += 1
    if not value:
        failed += 1
        printerr("HOME_DECK_FAIL " + why)

func _initialize() -> void:
    var fresh := {"inventory":{}, "decks":{}}
    var previous := JSON.stringify(fresh)
    var s: Dictionary = Status.inspect(fresh)
    check(s.ready and s.starter and s.count == Deck.SIZE,"fresh user starts with starter")
    check(JSON.stringify(fresh) == previous,"status does not initialize or modify profile")
    var codes: Array = Deck.validate_ids(Deck.STARTER).cards
    var inventory: Dictionary = {}
    for id in Deck.STARTER:
        inventory[Deck.code(id)] = 2
    var profile := {"inventory":inventory, "decks":{"chosen":codes.duplicate()}, "collection":{"selected":"chosen","names":{"chosen":"My Deck"}}}
    previous = JSON.stringify(profile)
    s = Status.inspect(profile)
    check(s.ready and not s.starter and s.name == "My Deck" and s.count == Deck.SIZE,"selected ready deck")
    check(JSON.stringify(profile) == previous,"selected inspection has no write")
    profile.collection.selected = ""
    s = Status.inspect(profile)
    check(not s.ready and s.reason == "NO_SELECTED_DECK","empty selection directs editor")
    profile.collection.selected = "chosen"
    profile.decks.chosen = codes.slice(0, 10)
    s = Status.inspect(profile)
    check(not s.ready and s.count == 10 and s.reason == "DECK_SIZE","incomplete deck counted and explained")
    profile.decks.chosen = codes.duplicate()
    profile.inventory.erase(codes[0])
    s = Status.inspect(profile)
    check(not s.ready and s.reason == "CARD_NOT_OWNED","unowned card explained")
    print("MULTIMENTAL_HOME_DECK_PASS checks=%d failures=%d" % [total,failed])
    quit(0 if failed == 0 else 1)
