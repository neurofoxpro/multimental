extends SceneTree
const Core = preload("res://src/match_core.gd")
var failures: int = 0
var checks: int = 0
func check(value: bool, label: String) -> void:
    checks += 1
    if not value:
        failures += 1
        printerr("PRODUCTION_TEST_FAIL: " + label)
func _initialize() -> void:
    var game = Core.new()
    game.start(42)
    check(game.state.board.size() == 9, "nine cells")
    check(game.state.players.size() == 2, "two players")
    check(game.state.players[game.state.active].hand.size() == 5, "opening draw")
    var before: String = game.digest()
    check(not game.apply(1 - int(game.state.active), {"type": "pass"}).ok, "reject other player")
    check(not game.apply(int(game.state.active), {"type": "play", "hand": -1, "cell": 99}).ok, "reject malformed move")
    check(before == game.digest(), "rejected commands do not mutate")
    check(game.adjacent(0, 1) and game.adjacent(0, 3) and not game.adjacent(0, 4), "orthogonal combat")
    var who: int = int(game.state.active)
    game.timeout(who)
    game.apply(1 - who, {"type": "pass"})
    game.timeout(who)
    check(int(game.state.winner) == 1 - who and game.state.reason == "timeout", "two missed own turns")
    game.start(13)
    who = int(game.state.active)
    for i in range(4):
        game.state.board[i] = {"id": 0, "owner": who, "attack": 1, "health": 2}
    game.state.players[who].coins = 6
    var result: Dictionary = game.apply(who, {"type": "play", "hand": 0, "cell": 4, "direction": 0})
    check(result.ok and game.state.winner == who, "fifth cell wins")
    game.start(99)
    who = int(game.state.active)
    game.state.players[who].deck.clear()
    game.state.players[who].hand.clear()
    game.apply(who, {"type": "pass"})
    check(game.state.winner == 1 - who and game.state.reason == "empty", "empty deck and hand lose")
    game.start(99)
    who = int(game.state.active)
    game.state.board[0] = {"id": 0, "owner": who, "attack": 2, "health": 1, "direction": 1}
    game.state.board[1] = {"id": 1, "owner": 1 - who, "attack": 1, "health": 2, "direction": 3}
    check(game.apply(who, {"type": "attack", "source": 0, "target": 1}).ok, "combat accepted")
    check(game.state.board[0] == null and game.state.board[1] == null, "simultaneous deaths")
    for seed_value in range(1, 101):
        game.start(seed_value)
        for step in range(120):
            if game.state.winner != -1:
                break
            var command: Dictionary = game.choose_ai()
            check(game.apply(int(game.state.active), command).ok, "AI legal")
        if game.state.winner == -1:
            game.end_on_time_limit()
        check(game.state.winner != -1, "bounded session")
        var duplicate = Core.new()
        duplicate.replay(seed_value, game.commands.duplicate(true))
        check(game.digest() == duplicate.digest(), "deterministic replay")
        check(game.count_cells(0) + game.count_cells(1) <= 9, "board invariant")
    if failures == 0:
        print("MULTIMENTAL_CORE_PASS checks=%d simulations=100" % checks)
    quit(0 if failures == 0 else 1)
