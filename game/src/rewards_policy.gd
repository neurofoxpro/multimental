extends RefCounted
## Local alpha proposal; no rating, stat bonuses, streaks or real-money value.
const VERSION: int = 1
const POLICY: String = "alpha-match20-win10-quests25x50-xp100-v1"
const MATCH_GOLD: int = 20
const WIN_GOLD: int = 10
const MATCH_XP: int = 10
const WIN_XP: int = 5
const LEVEL_XP: int = 100
const DAY_LIMIT: int = 3652425
const QUESTS: Dictionary = {
    "play_one": {"matches": 1, "gold": 25, "xp": 10},
    "play_three": {"matches": 3, "gold": 50, "xp": 20}
}

static func match_reward(outcome: String) -> Dictionary:
    return {"gold": MATCH_GOLD + (WIN_GOLD if outcome == "win" else 0), "xp": MATCH_XP + (WIN_XP if outcome == "win" else 0)}

static func level(xp: int) -> int:
    return 1 + int(xp / LEVEL_XP)
