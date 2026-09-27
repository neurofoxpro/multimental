extends SceneTree
const Core = preload("res://src/match_core.gd")
const Scenarios = preload("res://tests/support/balance_scenarios.gd")
class Trial:
    extends "res://src/match_core.gd"
    var overrides: Dictionary = {}
    func card(id: int) -> Dictionary:
        var definition: Dictionary = super.card(id)
        if not definition.is_empty() and overrides.has(str(id)):
            definition.merge(overrides[str(id)], true)
        return definition
var failures: int = 0
var rows: Array = []
var settings: Dictionary = {}
func _initialize() -> void:
    call_deferred("run_lab")
func deck(name: String) -> Array[int]:
    return Scenarios.deck(name)
func configure(g, seed_value: int, left: String, right: String) -> void:
    g.start(seed_value)
    for player in [0, 1]:
        var cards: Array[int] = deck(left if player == 0 else right)
        var rng := RandomNumberGenerator.new()
        rng.seed = seed_value * 1031 + (0 if player == int(g.state.first) else 1)
        for i in range(cards.size() - 1, 0, -1):
            var j: int = rng.randi_range(0, i)
            var saved: int = cards[i]
            cards[i] = cards[j]
            cards[j] = saved
        g.state.players[player].hand = cards.slice(0, 4)
        g.state.players[player].deck = cards.slice(4)
    g.state.players[int(g.state.first)].hand.append(g.state.players[int(g.state.first)].deck.pop_back())
func choose(g, policy: String, rng: RandomNumberGenerator) -> Dictionary:
    return Scenarios.choose(g, policy, rng)
func simulate(seed_value: int, left: String, right: String, policy: String) -> Dictionary:
    var g = Trial.new()
    g.overrides = settings.get("overrides", {})
    configure(g, seed_value, left, right)
    var rng := RandomNumberGenerator.new()
    rng.seed = seed_value * 313 + 7
    var row: Dictionary = {"seed": seed_value, "left": left, "right": right, "policy": policy, "first": g.state.first, "plays": {}, "attacks": {}, "damage": {}, "kills": {}, "opening_passes": 0, "forced_limit": false}
    for step in range(180):
        if int(g.state.winner) != -1:
            break
        var actor: int = int(g.state.active)
        var action: Dictionary = choose(g, policy, rng)
        var card_id: int = -1
        if action.type == "play":
            card_id = int(g.state.players[actor].hand[int(action.hand)])
            row.plays[str(card_id)] = int(row.plays.get(str(card_id), 0)) + 1
        elif action.type == "attack":
            card_id = int(g.state.board[int(action.source)].id)
            row.attacks[str(card_id)] = int(row.attacks.get(str(card_id), 0)) + 1
        elif int(g.state.turn) <= 2:
            row.opening_passes = int(row.opening_passes) + 1
        var response: Dictionary = g.apply(actor, action)
        if not response.ok:
            failures += 1
            printerr("BALANCE_ILLEGAL_COMMAND")
            break
        if action.type == "attack":
            for event in response.get("events", []):
                if event.type == "damage" and int(event.get("wave", 0)) == 0:
                    row.damage[str(card_id)] = int(row.damage.get(str(card_id), 0)) + int(event.amount)
                    if g.state.board[int(event.cell)] == null:
                        row.kills[str(card_id)] = int(row.kills.get(str(card_id), 0)) + 1
    if int(g.state.winner) == -1:
        row.forced_limit = true
        g.end_on_time_limit()
    row.winner = int(g.state.winner)
    row.reason = str(g.state.reason)
    row.turns = int(g.state.turn)
    row.income_bonus = int(g.state.income_bonus)
    row.center_used = g.state.board[4] != null
    return row
func run_lab() -> void:
    var args: PackedStringArray = OS.get_cmdline_user_args()
    if args.size() != 1:
        printerr("Provide one explicit balance configuration path")
        quit(1)
        return
    settings = JSON.parse_string(FileAccess.get_file_as_string(args[0]))
    var started: int = Time.get_ticks_msec()
    for pairing in settings.pairings:
        for policy in settings.policies:
            for n in range(int(settings.count)):
                var seed_value: int = int(settings.seed_start) + n
                rows.append(simulate(seed_value, pairing[0], pairing[1], policy))
                rows.append(simulate(seed_value, pairing[1], pairing[0], policy))
            print("BALANCE_PROGRESS ", pairing, " ", policy, " games=", rows.size())
    var output := FileAccess.open(str(settings.output), FileAccess.WRITE)
    if output == null:
        printerr("Balance output could not be written")
        quit(1)
        return
    output.store_string(JSON.stringify({"schema": 1, "rules": Core.RULES_ID, "settings": settings, "failures": failures, "runtime_ms": Time.get_ticks_msec() - started, "rows": rows}))
    output.close()
    print("BALANCE_SIMULATION_COMPLETE games=%d failures=%d" % [rows.size(), failures])
    quit(0 if failures == 0 else 1)
