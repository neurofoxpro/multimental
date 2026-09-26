extends SceneTree
## Reproducible counterfactual acquisition experiment; never edits a user profile.
const Deck = preload("res://src/deck_rules.gd")
const Collection = preload("res://src/collection_rules.gd")
const Model = preload("res://src/profile_state.gd")
const Economy = preload("res://src/economy_rules.gd")
const Craft = preload("res://src/crafting_policy.gd")
const Policy = preload("res://src/rewards_policy.gd")
const TRIALS: int = 256
const MAX_MATCHES: int = 300
const MATCHES_PER_DAY: int = 3
const MINUTES_PER_MATCH: int = 10
var checks: int = 0
var failures: int = 0
func check(value: bool, text: String) -> void:
    checks += 1
    if not value:
        failures += 1
        print("REWARDS_SIMULATION_FAIL " + text)
func target() -> Dictionary:
    var result: Dictionary = {}
    for id in range(7):
        result[Deck.code(id)] = 2
    result[Deck.code(7)] = 1
    return result
func ready(inventory: Dictionary, required: Dictionary) -> bool:
    for id in required:
        if int(inventory.get(id, 0)) < int(required[id]):
            return false
    return true
func acquire(trial: int, start_gold: int, crafting: bool, win_percent: int = 50) -> Dictionary:
    var inventory: Dictionary = {}
    for id in Deck.STARTER:
        var code: String = Deck.code(id)
        inventory[code] = int(inventory.get(code, 0)) + 1
    var required: Dictionary = target()
    var gold: int = start_gold
    var dust: int = 0
    var packs: int = 0
    var matches: int = 0
    var rng := RandomNumberGenerator.new()
    rng.seed = 730100 + trial
    while true:
        while gold >= Economy.PACK_PRICE and not ready(inventory, required):
            gold -= Economy.PACK_PRICE
            packs += 1
            # The same trial/pack index gives the same draw stream in both strategies.
            var cards: Array[String] = Economy.draw(("reward-acquisition-v1:" + str(trial) + ":" + str(packs)).sha256_text())
            check(cards.size() == Economy.PACK_SIZE, "real pack generator remains complete")
            for code in cards:
                var owned: int = int(inventory.get(code, 0))
                if owned < Deck.MAX_COPIES:
                    inventory[code] = owned + 1
                else:
                    dust += Economy.EXTRA_DUST
            if crafting:
                for code in required:
                    while dust >= Craft.COST and int(inventory.get(code, 0)) < int(required[code]):
                        dust -= Craft.COST
                        inventory[code] = int(inventory.get(code, 0)) + 1
        if ready(inventory, required) or matches >= MAX_MATCHES:
            return {"matches": matches, "packs": packs, "completed": ready(inventory, required)}
        matches += 1
        var outcome: String = "win" if rng.randi_range(0, 99) < win_percent else "loss"
        gold += int(Policy.match_reward(outcome).gold)
        var daily: int = (matches - 1) % MATCHES_PER_DAY + 1
        for quest in Policy.QUESTS.values():
            if daily == int(quest.matches):
                gold += int(quest.gold)
    return {}
func quantile(values: Array[int], fraction: float) -> Variant:
    if values.is_empty():
        return null
    return values[maxi(0, int(ceil(fraction * values.size())) - 1)]
func summarize(rows: Array[Dictionary], label: String) -> Dictionary:
    var matches: Array[int] = []
    var days: Array[int] = []
    var total: int = 0
    for row in rows:
        if row.completed:
            matches.append(int(row.matches))
            days.append(int(ceil(float(row.matches) / MATCHES_PER_DAY)))
            total += int(row.matches)
    matches.sort()
    days.sort()
    var result: Dictionary = {"scenario": label, "trials": rows.size(), "completed": matches.size(), "censoredAtMatchLimit": rows.size() - matches.size(), "quantilesConditionalOnCompletion": true, "matches": {}, "daysAtThreeMatchesPerDay": {}, "assumedActiveMinutes": {}}
    for percentile in [10, 50, 90, 95]:
        var key: String = "p" + str(percentile)
        var value: Variant = quantile(matches, float(percentile) / 100.0)
        result.matches[key] = value
        result.daysAtThreeMatchesPerDay[key] = quantile(days, float(percentile) / 100.0)
        result.assumedActiveMinutes[key] = null if value == null else int(value) * MINUTES_PER_MATCH
    result.matches["mean"] = null if matches.is_empty() else float(total) / matches.size()
    result.matches["maxObserved"] = null if matches.is_empty() else matches.back()
    return result
func _initialize() -> void:
    var codes: Array[String] = []
    for code in target():
        for copy in range(int(target()[code])):
            codes.append(code)
    check(Deck.validate_codes(codes).ok, "hypothetical target is a legal fifteen-card deck")
    var actual: Dictionary = Collection.apply(Model.fresh("simulation-only"), {"kind": "collection_init"}).profile
    check(ready(actual.inventory, target()), "actual alpha collection already owns target")
    for id in range(Deck.CARD_COUNT):
        check(actual.inventory[Deck.code(id)] == Deck.MAX_COPIES, "actual alpha grant kept intact")
    var reports: Array[Dictionary] = []
    for start_gold in [0, Economy.START_GOLD]:
        var packs_only: Array[Dictionary] = []
        var with_craft: Array[Dictionary] = []
        for trial in range(TRIALS):
            var a: Dictionary = acquire(trial, start_gold, false)
            var b: Dictionary = acquire(trial, start_gold, true)
            packs_only.append(a)
            with_craft.append(b)
            check((not a.completed) or (b.completed and int(b.matches) <= int(a.matches)), "target craft not slower under the same draws")
        reports.append(summarize(packs_only, "hypothetical-starter-only-gold" + str(start_gold) + "-packs"))
        reports.append(summarize(with_craft, "hypothetical-starter-only-gold" + str(start_gold) + "-packs-and-target-craft"))
    var no_wins: Array[Dictionary] = []
    for trial in range(TRIALS):
        no_wins.append(acquire(trial, 0, true, 0))
    reports.append(summarize(no_wins, "hypothetical-starter-only-gold0-craft-zero-wins"))
    check(no_wins.all(func(row: Dictionary): return row.completed), "all sampled zero-win players can complete target without victory requirement")
    check(acquire(9, 0, true) == acquire(9, 0, true), "fixed seed reproduces exact result")
    var report: Dictionary = {"schemaVersion": 1, "kind": "source-simulation-not-player-telemetry", "policy": Policy.POLICY, "actualAlpha": {"grant": Collection.GRANT, "requiredMatchesForAnyCurrentLegalDeck": 0, "inventoryReset": false}, "assumptions": {"targetCards": codes, "counterfactualInitialInventory": "one copy of STARTER only, NOT production grant", "trialsPerScenario": TRIALS, "maximumMatches": MAX_MATCHES, "matchesPerDay": MATCHES_PER_DAY, "assumedMinutesPerMatch": MINUTES_PER_MATCH, "winPercent": 50, "dailyQuestsClaimed": true, "craftStrategy": "greedy target order, no recycling", "pairedDraws": true, "seedBase": 730100, "percentiles": "nearest rank among completed trials; censored counts reported separately"}, "scenarios": reports, "limits": ["hypothetical deficits do not alter alpha inventory", "device clock is not trusted server time", "ten minutes is an assumption, not measured match duration", "finite simulated trials do not prove worst-case acquisition time", "no grind or purchase requirement is introduced"]}
    print("REWARDS_SIMULATION_JSON " + JSON.stringify(report))
    if failures == 0:
        print("MULTIMENTAL_REWARDS_SIMULATION_PASS checks=" + str(checks) + " trials=" + str(TRIALS * 5))
    quit(0 if failures == 0 else 1)
