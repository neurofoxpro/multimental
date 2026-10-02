extends RefCounted
# Pure profile rules; no filesystem, clock, nodes or networking.
const Collection = preload("res://src/collection_rules.gd")
const Economy = preload("res://src/economy_rules.gd")
const Crafting = preload("res://src/crafting_rules.gd")
const Rewards = preload("res://src/rewards_rules.gd")
const SCHEMA: int = 1
const LIMIT: int = 1000000000
const RECEIPT_LIMIT: int = 4096

static func fresh(profile_id: String) -> Dictionary:
    return {"schemaVersion": SCHEMA, "profileId": profile_id, "revision": 0, "inventory": {}, "decks": {}, "wallet": {"gold": 0, "dust": 0}, "settings": {"language": "ru"}, "stats": {"matches": 0, "wins": 0, "losses": 0, "draws": 0}, "receipts": {}, "lastMatch": {}}

static func count_value(value: Variant) -> bool:
    return (typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT) and is_finite(float(value)) and float(value) == floor(float(value)) and value >= 0 and value <= LIMIT

static func identifier(value: Variant) -> bool:
    if typeof(value) != TYPE_STRING or value.is_empty() or value.length() > 96:
        return false
    for character in value:
        if not character in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_:.":
            return false
    return true

static func valid(value: Variant) -> bool:
    if typeof(value) != TYPE_DICTIONARY:
        return false
    if value.get("schemaVersion") != SCHEMA or not identifier(value.get("profileId")) or not count_value(value.get("revision")):
        return false
    for key in ["inventory", "decks", "wallet", "settings", "stats", "receipts", "lastMatch"]:
        if typeof(value.get(key)) != TYPE_DICTIONARY:
            return false
    if value.wallet.size() != 2 or value.inventory.size() > 10000 or value.decks.size() > 100 or value.receipts.size() > RECEIPT_LIMIT:
        return false
    for key in ["gold", "dust"]:
        if not count_value(value.wallet.get(key)):
            return false
    for key in ["matches", "wins", "losses", "draws"]:
        if not count_value(value.stats.get(key)):
            return false
    if int(value.stats.matches) != int(value.stats.wins) + int(value.stats.losses) + int(value.stats.draws):
        return false
    if value.settings.get("language") not in ["ru", "en"]:
        return false
    for key in value.inventory:
        if not identifier(key) or not count_value(value.inventory[key]):
            return false
    for key in value.decks:
        if not identifier(key) or typeof(value.decks[key]) != TYPE_ARRAY or value.decks[key].size() > 80:
            return false
        for card in value.decks[key]:
            if not identifier(card):
                return false
    for key in value.receipts:
        if not identifier(key) or typeof(value.receipts[key]) != TYPE_STRING or value.receipts[key].length() != 64:
            return false
    return Collection.valid(value) and Economy.valid(value) and Crafting.valid(value) and Rewards.valid(value)

static func failure(code: String) -> Dictionary:
    return {"ok": false, "code": code}

static func apply(profile: Dictionary, transaction_id: String, command: Dictionary) -> Dictionary:
    if not valid(profile) or not identifier(transaction_id):
        return failure("INVALID_PROFILE_OR_ID")
    var operation_hash: String = JSON.stringify(command, "", true).sha256_text()
    if profile.receipts.has(transaction_id):
        if profile.receipts[transaction_id] != operation_hash:
            return failure("TRANSACTION_CONFLICT")
        return {"ok": true, "duplicate": true, "profile": profile.duplicate(true)}
    if profile.receipts.size() >= RECEIPT_LIMIT:
        return failure("JOURNAL_FULL")
    var next: Dictionary = profile.duplicate(true)
    match command.get("kind", ""):
        "record_match", "reward_match":
            if command.get("kind") == "reward_match":
                var rewarded: Dictionary = Rewards.apply(next, command)
                if not rewarded.ok:
                    return rewarded
                next = rewarded.profile
            var outcome: String = str(command.get("outcome", ""))
            if outcome not in ["win", "loss", "draw"]:
                return failure("INVALID_OUTCOME")
            var field: String = {"win": "wins", "loss": "losses", "draw": "draws"}[outcome]
            next.stats[field] = int(next.stats[field]) + 1
            next.stats.matches = int(next.stats.matches) + 1
            next.lastMatch = {"id": transaction_id, "outcome": outcome}
        "rewards_day", "reward_claim":
            var rewarded: Dictionary = Rewards.apply(next, command)
            if not rewarded.ok:
                return rewarded
            next = rewarded.profile
        "language":
            if command.get("value") not in ["ru", "en"]:
                return failure("INVALID_LANGUAGE")
            next.settings.language = command.value
        "card_craft", "card_recycle":
            var crafted: Dictionary = Crafting.apply(next, command)
            if not crafted.ok:
                return crafted
            next = crafted.profile
        "economy_init", "pack_buy":
            var purchased: Dictionary = Economy.apply(next, command)
            if not purchased.ok:
                return purchased
            next = purchased.profile
        "collection_init", "deck_save", "deck_select", "deck_delete":
            var changed: Dictionary = Collection.apply(next, command)
            if not changed.ok:
                return changed
            next = changed.profile
        _:
            return failure("UNKNOWN_COMMAND")
    next.receipts[transaction_id] = operation_hash
    return {"ok": true, "duplicate": false, "profile": next} if valid(next) else failure("LIMIT_EXCEEDED")
