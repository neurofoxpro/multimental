extends RefCounted
const Deck = preload("res://src/deck_rules.gd")
const Collection = preload("res://src/collection_rules.gd")
const Policy = preload("res://src/crafting_policy.gd")

static func required_copies(profile: Dictionary, code: String) -> int:
    var required: int = 0
    for cards in profile.get("decks", {}).values():
        required = maxi(required, cards.count(code))
    return required

static func valid(profile: Dictionary) -> bool:
    if not profile.has("crafting"):
        return true
    var meta: Variant = profile.crafting
    if typeof(meta) != TYPE_DICTIONARY or meta.size() != 5 or meta.get("version") != Policy.VERSION or meta.get("policy") != Policy.POLICY:
        return false
    if not Deck.integer(meta.get("crafted"), 0, Policy.MAX_COUNTER) or not Deck.integer(meta.get("recycled"), 0, Policy.MAX_COUNTER):
        return false
    var last: Variant = meta.get("last")
    if typeof(last) != TYPE_DICTIONARY or last.size() != 3 or Deck.card_id(last.get("card")) < 0:
        return false
    if last.get("kind") == "card_craft":
        return int(meta.crafted) > 0 and last.get("dust") == -Policy.COST
    if last.get("kind") == "card_recycle":
        return int(meta.recycled) > 0 and last.get("dust") == Policy.RECYCLE
    return false

static func quote(profile: Dictionary, code: String, kind: String) -> Dictionary:
    if not profile.has("collection") or not Collection.valid(profile) or not valid(profile):
        return Deck.failure("CRAFT_PROFILE_NOT_READY")
    if Deck.card_id(code) < 0 or kind not in ["card_craft", "card_recycle"]:
        return Deck.failure("INVALID_CRAFT_COMMAND")
    var owned: int = int(profile.inventory.get(code, 0))
    if kind == "card_craft":
        if owned >= Deck.MAX_COPIES:
            return Deck.failure("COPY_LIMIT")
        if int(profile.wallet.dust) < Policy.COST:
            return Deck.failure("NOT_ENOUGH_DUST")
    else:
        if owned <= required_copies(profile, code):
            return Deck.failure("CARD_USED_IN_DECK")
        if int(profile.wallet.dust) > Policy.MAX_COUNTER - Policy.RECYCLE:
            return Deck.failure("WALLET_LIMIT")
    return {"ok": true, "card": code, "kind": kind, "dust": -Policy.COST if kind == "card_craft" else Policy.RECYCLE}

static func apply(profile: Dictionary, command: Dictionary) -> Dictionary:
    if command.size() != 2 or typeof(command.get("card")) != TYPE_STRING or typeof(command.get("kind")) != TYPE_STRING:
        return Deck.failure("INVALID_CRAFT_COMMAND")
    var result: Dictionary = quote(profile, command.card, command.kind)
    if not result.ok:
        return result
    var next: Dictionary = profile.duplicate(true)
    if not next.has("crafting"):
        next.crafting = {"version": Policy.VERSION, "policy": Policy.POLICY, "crafted": 0, "recycled": 0, "last": {}}
    var counter: String = "crafted" if command.kind == "card_craft" else "recycled"
    if int(next.crafting[counter]) >= Policy.MAX_COUNTER:
        return Deck.failure("CRAFT_COUNTER_LIMIT")
    next.crafting[counter] = int(next.crafting[counter]) + 1
    var code: String = command.card
    next.inventory[code] = int(next.inventory.get(code, 0)) + (1 if counter == "crafted" else -1)
    next.wallet.dust = int(next.wallet.dust) + int(result.dust)
    next.crafting.last = {"card": code, "kind": command.kind, "dust": result.dust}
    return {"ok": true, "profile": next} if valid(next) and Collection.valid(next) else Deck.failure("INVALID_CRAFT_RESULT")
