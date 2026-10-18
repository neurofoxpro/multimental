extends RefCounted
## Pure, bounded offline progression. Commands carry a frozen day and match number.
const Policy = preload("res://src/rewards_policy.gd")
const Deck = preload("res://src/deck_rules.gd")
const LIMIT: int = 1000000000

static func fresh() -> Dictionary:
    return {"version": Policy.VERSION, "policy": Policy.POLICY, "xp": 0, "day": 0, "played": 0, "claimed": [], "last": {}}

static func valid(profile: Dictionary) -> bool:
    if not profile.has("rewards"):
        return true
    var r: Variant = profile.rewards
    if typeof(r) != TYPE_DICTIONARY or r.size() != 7 or r.get("version") != Policy.VERSION or r.get("policy") != Policy.POLICY:
        return false
    if not Deck.integer(r.get("xp"), 0, LIMIT) or not Deck.integer(r.get("day"), 0, Policy.DAY_LIMIT) or not Deck.integer(r.get("played"), 0, 3):
        return false
    if typeof(r.get("claimed")) != TYPE_ARRAY or r.claimed.size() > Policy.QUESTS.size() or typeof(r.get("last")) != TYPE_DICTIONARY:
        return false
    var seen: Dictionary = {}
    for quest in r.claimed:
        if typeof(quest) != TYPE_STRING or not Policy.QUESTS.has(quest) or seen.has(quest) or int(r.played) < int(Policy.QUESTS[quest].matches):
            return false
        seen[quest] = true
    if r.last.is_empty():
        return true
    return r.last.size() == 4 and r.last.get("kind") in ["match", "quest"] and Deck.integer(r.last.get("gold"), 0, LIMIT) and Deck.integer(r.last.get("xp"), 0, LIMIT) and Deck.integer(r.last.get("day"), 0, int(r.day))

static func at_day(profile: Dictionary, day: int) -> Dictionary:
    var r: Dictionary = profile.get("rewards", fresh()).duplicate(true)
    if day > int(r.day):
        r.day = day
        r.played = 0
        r.claimed = []
    return r

static func apply(profile: Dictionary, command: Dictionary) -> Dictionary:
    if not valid(profile) or not Deck.integer(command.get("day"), 0, Policy.DAY_LIMIT):
        return Deck.failure("INVALID_REWARDS_DAY_OR_PROFILE")
    var next: Dictionary = profile.duplicate(true)
    var day: int = int(command.day)
    var kind: String = str(command.get("kind", ""))
    var reward: Dictionary = {"gold": 0, "xp": 0}
    if kind == "rewards_day":
        if command.size() != 2:
            return Deck.failure("UNKNOWN_REWARDS_FIELD")
        next.rewards = at_day(next, day)
        return {"ok": true, "profile": next}
    if kind == "reward_match":
        if command.size() != 6 or command.get("policy") != Policy.POLICY or command.get("outcome") not in ["win", "loss", "draw"] or typeof(command.get("replay")) != TYPE_DICTIONARY:
            return Deck.failure("INVALID_REWARDED_MATCH")
        if not Deck.integer(command.get("matchNumber"), 1, LIMIT) or int(command.matchNumber) != int(profile.stats.matches) + 1:
            return Deck.failure("STALE_OR_GAPPED_MATCH_NUMBER")
        next.rewards = at_day(next, day)
        next.rewards.played = mini(3, int(next.rewards.played) + 1)
        reward = Policy.match_reward(str(command.outcome))
    elif kind == "reward_claim":
        if command.size() != 3 or typeof(command.get("quest")) != TYPE_STRING or not Policy.QUESTS.has(command.quest):
            return Deck.failure("INVALID_REWARD_QUEST")
        if not next.has("rewards") or day != int(next.rewards.day):
            return Deck.failure("REWARD_DAY_CHANGED")
        if command.quest in next.rewards.claimed:
            return Deck.failure("REWARD_ALREADY_CLAIMED")
        var quest: Dictionary = Policy.QUESTS[command.quest]
        if int(next.rewards.played) < int(quest.matches):
            return Deck.failure("REWARD_NOT_READY")
        next.rewards.claimed.append(command.quest)
        reward = {"gold": int(quest.gold), "xp": int(quest.xp)}
    else:
        return Deck.failure("UNKNOWN_REWARD_COMMAND")
    if int(next.wallet.gold) > LIMIT - int(reward.gold) or int(next.rewards.xp) > LIMIT - int(reward.xp):
        return Deck.failure("REWARD_LIMIT")
    next.wallet.gold = int(next.wallet.gold) + int(reward.gold)
    next.rewards.xp = int(next.rewards.xp) + int(reward.xp)
    next.rewards.last = {"kind": "match" if kind == "reward_match" else "quest", "gold": reward.gold, "xp": reward.xp, "day": next.rewards.day}
    return {"ok": true, "profile": next} if valid(next) else Deck.failure("INVALID_REWARD_RESULT")
