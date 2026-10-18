extends SceneTree
const Model = preload("res://src/profile_state.gd")
const Journal = preload("res://src/profile_journal.gd")
const Rules = preload("res://src/rewards_rules.gd")
const Policy = preload("res://src/rewards_policy.gd")
const Store = preload("res://src/profile_store.gd")
const Controller = preload("res://src/profile_controller.gd")
var checks: int = 0
var failures: int = 0
class FaultStore extends Store:
    var lose: bool = false
    var torn: bool = false
    func _write_slot(filename: String, text: String) -> Error:
        if torn:
            var file := FileAccess.open(filename, FileAccess.WRITE)
            file.store_string(text.substr(0, 35))
            file.close()
            return ERR_FILE_CANT_WRITE
        var result: Error = super._write_slot(filename, text)
        if lose and result == OK:
            lose = false
            return ERR_FILE_CANT_WRITE
        return result
func check(value: bool, text: String) -> void:
    checks += 1
    if not value:
        failures += 1
        print("REWARDS_FAIL " + text)
func command(number: int, outcome: String = "win", day: int = 20000) -> Dictionary:
    return {"kind": "reward_match", "policy": Policy.POLICY, "matchNumber": number, "outcome": outcome, "day": day, "replay": {"rules": "fixture", "session": "match-" + str(number), "commands": []}}
func advance(p: Dictionary, c: Dictionary) -> Dictionary:
    var result: Dictionary = Journal.apply_ordered(p, int(p.get("ordered", {}).get("head", 0)) + 1, c)
    check(result.ok, "ordered command " + str(c.kind))
    return result.get("profile", p)
func _initialize() -> void:
    var original: Dictionary = Model.fresh("reward-tests")
    check(Model.valid(original) and not original.has("rewards"), "legacy profile remains compatible without auto-grants")
    var p: Dictionary = advance(original, command(1))
    check(p.stats.matches == 1 and p.stats.wins == 1 and p.wallet.gold == 30 and p.rewards.xp == 15, "result and reward together")
    check(p.lastMatch.replay.session == "match-1" and original.stats.matches == 0 and original.wallet.gold == 0, "replay atomic and source untouched")
    check(p.inventory == original.inventory and p.decks == original.decks, "match never removes collection")
    var repeat: Dictionary = Journal.apply_ordered(JSON.parse_string(JSON.stringify(p)), 1, command(1))
    check(repeat.ok and repeat.duplicate and repeat.profile.wallet.gold == 30, "JSON retry idempotent")
    check(not Journal.apply_ordered(p, 2, command(1)).ok, "old result cannot be reissued under a new journal sequence")
    check(not Journal.apply_ordered(p, 2, command(3)).ok, "gapped match number rejected")
    for changes in [{"day": -1}, {"day": true}, {"day": 1.5}, {"day": Policy.DAY_LIMIT + 1}, {"outcome": "bad"}, {"policy": "future"}, {"extra": 1}, {"matchNumber": true}, {"replay": []}]:
        var bad: Dictionary = command(2)
        bad.merge(changes, true)
        check(not Journal.apply_ordered(p, 2, bad).ok, "invalid payload " + str(changes))
    check(not Journal.apply_ordered(p, 2, {"kind": "reward_claim", "day": 20000, "quest": "play_three"}).ok, "unfinished quest cannot pay")
    p = advance(p, {"kind": "reward_claim", "day": 20000, "quest": "play_one"})
    check(p.wallet.gold == 55 and p.rewards.xp == 25, "first voluntary quest reward")
    check(Journal.apply_ordered(p, 2, {"kind": "reward_claim", "day": 20000, "quest": "play_one"}).duplicate, "same claim retry safe")
    check(not Journal.apply_ordered(p, 3, {"kind": "reward_claim", "day": 20000, "quest": "play_one"}).ok, "new transaction cannot repeat quest")
    p = advance(p, command(2, "loss", 19999))
    check(p.rewards.day == 20000 and p.rewards.played == 2 and p.wallet.gold == 75 and p.stats.losses == 1, "clock rollback does not reset quests; defeat earns no penalty")
    p = advance(p, command(3, "draw"))
    p = advance(p, {"kind": "reward_claim", "day": 20000, "quest": "play_three"})
    check(p.wallet.gold == 145 and p.rewards.xp == 65 and p.stats.draws == 1, "third-match quest and draw")
    var before: Dictionary = p.duplicate(true)
    p = advance(p, {"kind": "rewards_day", "day": 20005})
    check(p.rewards.played == 0 and p.rewards.claimed.is_empty() and p.wallet == before.wallet and p.rewards.xp == before.rewards.xp, "missed days do not punish; no streak or retroactive grants")
    check(not Journal.apply_ordered(p, int(p.ordered.head) + 1, {"kind": "reward_claim", "day": 20000, "quest": "play_one"}).ok, "stale day claim rejected")
    p = advance(p, {"kind": "rewards_day", "day": 20000})
    check(p.rewards.day == 20005 and p.rewards.played == 0, "old day cannot reopen")
    for n in range(100):
        p = advance(p, {"kind": "language", "value": "en" if n % 2 == 0 else "ru"})
    check(p.ordered.receipts.size() == Journal.WINDOW, "bounded receipt window")
    check(Journal.apply_ordered(p, 1, command(1)).get("code") == "STALE_SEQUENCE", "compacted sequence rejected")
    check(not Journal.apply_ordered(p, int(p.ordered.head) + 1, command(1)).ok, "compacted match cannot be paid again under new sequence")
    var high: Dictionary = Model.fresh("high")
    high.wallet.gold = Model.LIMIT
    check(not Journal.apply_ordered(high, 1, command(1)).ok and high.stats.matches == 0, "overflow rejects whole result")
    high = Model.fresh("xp-high")
    high.rewards = Rules.fresh()
    high.rewards.xp = Model.LIMIT
    check(not Journal.apply_ordered(high, 1, command(1)).ok, "XP overflow rejected")
    check(Policy.level(0) == 1 and Policy.level(99) == 1 and Policy.level(100) == 2 and Policy.level(201) == 3, "level derives from XP without stat modification")
    var legacy: Dictionary = Model.apply(Model.fresh("legacy"), "old", {"kind": "record_match", "outcome": "win"}).profile
    legacy = advance(legacy, command(2))
    check(legacy.stats.matches == 2 and legacy.wallet.gold == 30, "no rewards invented for historical matches")
    var directory: String = "user://profile-tests/rewards-" + Crypto.new().generate_random_bytes(10).hex_encode()
    var disk = FaultStore.new(directory)
    var ctl = Controller.new()
    ctl.storage = disk
    ctl.legacy_settings = ""
    check(ctl.open_profile(), "isolated storage")
    disk.lose = true
    check(not ctl.commit(command(1)), "lost write acknowledgement remains failure")
    check(ctl.pending.command == command(1), "frozen day and match number retained")
    check(ctl.commit(command(1)) and ctl.state().stats.matches == 1 and ctl.state().wallet.gold == 30, "readback retry pays once")
    var reopened = Store.new(directory)
    check(reopened.open_store("").ok and reopened.data.rewards.xp == 15 and reopened.data.lastMatch.replay.session == "match-1", "disk restart restores atomic result")
    disk.torn = true
    check(not ctl.commit(command(2, "loss", 20001)), "torn write not success")
    disk.torn = false
    check(ctl.flush() and ctl.state().stats.matches == 2 and ctl.state().wallet.gold == 50, "torn write recovers and retries unchanged command")
    var future: Dictionary = ctl.state()
    future.rewards.version = 2
    future.revision = int(future.revision) + 1
    var payload: String = JSON.stringify(future)
    var file := FileAccess.open(directory.path_join("b.json"), FileAccess.WRITE)
    file.store_string(JSON.stringify({"format": 1, "payload": payload, "sha256": payload.sha256_text()}))
    file.close()
    var hash_before: String = FileAccess.get_sha256(directory.path_join("b.json"))
    check(Store.new(directory).open_store("").get("code") == "STORE_UNSUPPORTED", "future reward version blocks downgrade to other slot")
    check(FileAccess.get_sha256(directory.path_join("b.json")) == hash_before, "future bytes preserved")
    if failures == 0:
        for name in ["a.json", "b.json"]:
            DirAccess.remove_absolute(directory.path_join(name))
        DirAccess.remove_absolute(directory)
        print("MULTIMENTAL_REWARDS_PASS checks=" + str(checks))
    quit(0 if failures == 0 else 1)
