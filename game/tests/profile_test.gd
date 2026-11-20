extends SceneTree
const Model = preload("res://src/profile_state.gd")
var checks: int = 0
var failures: int = 0
func check(value: bool, message: String) -> void:
    checks += 1
    if not value:
        failures += 1
        print("PROFILE_FAIL " + message)
func _initialize() -> void:
    var p: Dictionary = Model.fresh("test-profile")
    check(Model.valid(p), "fresh profile")
    var win: Dictionary = Model.apply(p, "match:1", {"kind": "record_match", "outcome": "win"})
    check(win.ok and win.profile.stats.wins == 1, "win counted")
    check(p.stats.matches == 0 and p.receipts.is_empty(), "input immutable")
    var repeat: Dictionary = Model.apply(win.profile, "match:1", {"kind": "record_match", "outcome": "win"})
    check(repeat.ok and repeat.duplicate and repeat.profile.stats.wins == 1, "retry idempotent")
    check(not Model.apply(win.profile, "match:1", {"kind": "record_match", "outcome": "loss"}).ok, "conflicting reuse")
    check(not Model.apply(p, "bad/id", {"kind": "record_match", "outcome": "win"}).ok, "invalid transaction id")
    check(not Model.apply(p, "x", {"kind": "execute", "text": "ignored"}).ok, "unknown command")
    check(not Model.apply(p, "x", {"kind": "record_match", "outcome": "cheat"}).ok, "unknown outcome")
    var language: Dictionary = Model.apply(p, "lang:1", {"kind": "language", "value": "en"})
    check(language.ok and language.profile.settings.language == "en", "language command")
    check(not Model.apply(p, "lang:2", {"kind": "language", "value": "xx"}).ok, "invalid locale")
    for bad in [-1, 1.5, NAN, INF, "2", null, true, Model.LIMIT + 1]:
        check(not Model.count_value(bad), "invalid numeric value")
    for key in ["inventory", "decks", "wallet", "settings", "stats", "receipts", "lastMatch"]:
        var corrupt: Dictionary = p.duplicate(true)
        corrupt[key] = []
        check(not Model.valid(corrupt), "wrong shape " + key)
    var future: Dictionary = p.duplicate(true)
    future.schemaVersion = 999
    check(not Model.valid(future), "future schema refused")
    var negative: Dictionary = p.duplicate(true)
    negative.wallet.gold = -1
    check(not Model.valid(negative), "negative balance")
    var stats: Dictionary = p.duplicate(true)
    stats.stats.wins = 1
    check(not Model.valid(stats), "inconsistent stats")
    var full: Dictionary = p.duplicate(true)
    for n in range(Model.RECEIPT_LIMIT):
        full.receipts["tx:" + str(n)] = "a".repeat(64)
    check(Model.valid(full), "bounded ledger valid")
    check(not Model.apply(full, "new", {"kind": "language", "value": "en"}).ok, "ledger refuses overflow")
    var roundtrip: Variant = JSON.parse_string(JSON.stringify(win.profile))
    check(Model.valid(roundtrip), "JSON roundtrip")
    check(Model.apply(roundtrip, "match:1", {"kind": "record_match", "outcome": "win"}).duplicate, "retry after serialization")
    for n in range(200):
        var result: Dictionary = Model.apply(p, "simulation:" + str(n), {"kind": "record_match", "outcome": ["win", "loss", "draw"][n % 3]})
        check(result.ok, "simulated transaction")
        p = result.profile
    check(p.stats.matches == 200 and Model.valid(p), "200 consistent matches")
    print("MULTIMENTAL_PROFILE_PASS checks=" + str(checks)) if failures == 0 else print("PROFILE_FAILED " + str(failures))
    quit(0 if failures == 0 else 1)
