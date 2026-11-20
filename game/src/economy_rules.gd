extends RefCounted
## Offline alpha pack policy. All changes pass through the existing profile journal.
const Deck = preload("res://src/deck_rules.gd")
const Collection = preload("res://src/collection_rules.gd")
const VERSION: int = 1
const POLICY: String = "alpha-uniform-30-pack5-v1"
const GRANT: String = "alpha-500-gold-once-v1"
const PACK_SIZE: int = 5
const PACK_PRICE: int = 100
const EXTRA_DUST: int = 10
const START_GOLD: int = 500
const LIMIT: int = 1000000000

static func entropy_valid(value: Variant) -> bool:
    if typeof(value) != TYPE_STRING or value.length() != 64:
        return false
    for letter in value:
        if not letter in "0123456789abcdef":
            return false
    return true

static func draw(entropy: String) -> Array[String]:
    var cards: Array[String] = []
    if not entropy_valid(entropy):
        return cards
    for counter in range(256):
        var digest: String = (POLICY + ":" + entropy + ":" + str(counter)).sha256_text()
        var value: int = digest.substr(0, 8).hex_to_int()
        if value < 4294967280:
            cards.append(Deck.code(value % Deck.CARD_COUNT))
            if cards.size() == PACK_SIZE:
                break
    return cards

static func valid(profile: Dictionary) -> bool:
    if not profile.has("economy"):
        return true
    var meta: Variant = profile.economy
    if typeof(meta) != TYPE_DICTIONARY or meta.size() != 5 or meta.get("version") != VERSION or meta.get("policy") != POLICY or meta.get("grant") != GRANT:
        return false
    if not Deck.integer(meta.get("packs"), 0, LIMIT) or typeof(meta.get("lastPack")) != TYPE_DICTIONARY:
        return false
    if int(meta.packs) == 0:
        return meta.lastPack.is_empty()
    var receipt: Dictionary = meta.lastPack
    if receipt.size() != 5 or receipt.get("number") != meta.packs or receipt.get("policy") != POLICY or receipt.get("price") != PACK_PRICE:
        return false
    if not Deck.integer(receipt.get("dust"), 0, PACK_SIZE * EXTRA_DUST) or int(receipt.dust) % EXTRA_DUST != 0:
        return false
    if typeof(receipt.get("cards")) != TYPE_ARRAY or receipt.cards.size() != PACK_SIZE:
        return false
    for code in receipt.cards:
        if Deck.card_id(code) < 0:
            return false
    return true

static func apply(profile: Dictionary, command: Dictionary) -> Dictionary:
    if not Collection.valid(profile) or not profile.has("collection") or not valid(profile):
        return Deck.failure("ECONOMY_PROFILE_NOT_READY")
    var next: Dictionary = profile.duplicate(true)
    if command.get("kind") == "economy_init":
        if command.size() != 1:
            return Deck.failure("UNKNOWN_FIELD")
        if next.has("economy"):
            return {"ok": true, "profile": next}
        if int(next.wallet.gold) > LIMIT - START_GOLD:
            return Deck.failure("WALLET_LIMIT")
        next.wallet.gold = int(next.wallet.gold) + START_GOLD
        next.economy = {"version": VERSION, "policy": POLICY, "grant": GRANT, "packs": 0, "lastPack": {}}
        return {"ok": true, "profile": next}
    if command.get("kind") != "pack_buy" or command.size() != 2 or not entropy_valid(command.get("entropy")):
        return Deck.failure("INVALID_PACK_COMMAND")
    if not next.has("economy"):
        return Deck.failure("ECONOMY_NOT_INITIALIZED")
    if int(next.wallet.gold) < PACK_PRICE:
        return Deck.failure("NOT_ENOUGH_GOLD")
    if int(next.economy.packs) >= LIMIT:
        return Deck.failure("PACK_COUNTER_LIMIT")
    var cards: Array[String] = draw(str(command.entropy))
    if cards.size() != PACK_SIZE:
        return Deck.failure("PACK_GENERATION_FAILED")
    var dust: int = 0
    for code in cards:
        var owned: int = int(next.inventory.get(code, 0))
        if owned < Deck.MAX_COPIES:
            next.inventory[code] = owned + 1
        else:
            dust += EXTRA_DUST
    if int(next.wallet.dust) > LIMIT - dust:
        return Deck.failure("WALLET_LIMIT")
    next.wallet.gold = int(next.wallet.gold) - PACK_PRICE
    next.wallet.dust = int(next.wallet.dust) + dust
    next.economy.packs = int(next.economy.packs) + 1
    next.economy.lastPack = {"number": next.economy.packs, "policy": POLICY, "price": PACK_PRICE, "cards": cards, "dust": dust}
    return {"ok": true, "profile": next} if valid(next) and Collection.valid(next) else Deck.failure("INVALID_ECONOMY_RESULT")
