extends RefCounted
## Local alpha collection: two copies of each current card, no paid currency.
const Deck = preload("res://src/deck_rules.gd")
const VERSION: int = 1
const MAX_DECKS: int = 12
const GRANT: String = "alpha-open-30x2-v1"

static func valid(profile: Dictionary) -> bool:
    if not profile.has("collection"):
        return true
    var meta: Variant = profile.collection
    if typeof(meta) != TYPE_DICTIONARY or meta.get("version") != VERSION or meta.get("grant") != GRANT:
        return false
    if typeof(meta.get("names")) != TYPE_DICTIONARY or typeof(meta.get("selected")) != TYPE_STRING:
        return false
    if profile.decks.size() > MAX_DECKS or meta.names.size() != profile.decks.size():
        return false
    for key in profile.inventory:
        if Deck.card_id(key) < 0:
            return false
    for key in profile.decks:
        if not Deck.valid_key(key) or not Deck.valid_name(meta.names.get(key)):
            return false
        if not Deck.validate_codes(profile.decks[key], profile.inventory, true).ok:
            return false
    return meta.selected == "" or (profile.decks.has(meta.selected) and Deck.validate_codes(profile.decks[meta.selected], profile.inventory).ok)

static func apply(profile: Dictionary, command: Dictionary) -> Dictionary:
    var next: Dictionary = profile.duplicate(true)
    var kind: String = str(command.get("kind", ""))
    if kind == "collection_init":
        if command.size() != 1:
            return Deck.failure("UNKNOWN_FIELD")
        if next.has("collection"):
            return {"ok": true, "profile": next} if valid(next) else Deck.failure("INVALID_COLLECTION")
        if not next.inventory.is_empty() or not next.decks.is_empty():
            return Deck.failure("LEGACY_COLLECTION_NEEDS_MIGRATION")
        for id in range(Deck.CARD_COUNT):
            next.inventory[Deck.code(id)] = Deck.MAX_COPIES
        next.decks["starter"] = Deck.validate_ids(Deck.STARTER).cards
        next.collection = {"version": VERSION, "grant": GRANT, "names": {"starter": "Starter"}, "selected": "starter"}
        return {"ok": true, "profile": next}
    if not next.has("collection") or not valid(next):
        return Deck.failure("COLLECTION_NOT_READY")
    var id: Variant = command.get("id")
    if not Deck.valid_key(id):
        return Deck.failure("INVALID_DECK_ID")
    if kind == "deck_save":
        if command.size() != 4 or not Deck.valid_name(command.get("name")):
            return Deck.failure("INVALID_DECK_NAME")
        var parsed: Dictionary = Deck.validate_codes(command.get("cards"), next.inventory, true)
        if not parsed.ok:
            return parsed
        if not next.decks.has(id) and next.decks.size() >= MAX_DECKS:
            return Deck.failure("DECK_LIMIT")
        next.decks[id] = parsed.cards.duplicate()
        next.collection.names[id] = command.name
        if next.collection.selected == id and not parsed.ready:
            next.collection.selected = ""
    elif kind == "deck_select":
        if command.size() != 2 or not next.decks.has(id):
            return Deck.failure("UNKNOWN_DECK")
        var parsed: Dictionary = Deck.validate_codes(next.decks[id], next.inventory)
        if not parsed.ok:
            return parsed
        next.collection.selected = id
    elif kind == "deck_delete":
        if command.size() != 2 or not next.decks.has(id):
            return Deck.failure("UNKNOWN_DECK")
        next.decks.erase(id)
        next.collection.names.erase(id)
        if next.collection.selected == id:
            next.collection.selected = ""
    else:
        return Deck.failure("UNKNOWN_COLLECTION_COMMAND")
    return {"ok": true, "profile": next} if valid(next) else Deck.failure("INVALID_COLLECTION_RESULT")

static func selected(profile: Dictionary) -> Dictionary:
    if not profile.has("collection") or not valid(profile):
        return Deck.failure("COLLECTION_NOT_READY")
    return Deck.validate_codes(profile.decks.get(profile.collection.selected), profile.inventory)
