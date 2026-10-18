extends SceneTree
const Core = preload("res://src/match_core.gd")
const Driver = preload("res://src/net/room_device_test.gd")
var failures: int = 0
var checks: int = 0
func check(ok: bool, description: String) -> void:
    checks += 1
    if not ok:
        failures += 1
        printerr("PRODUCTION_TEST_FAIL: " + description)
func unit(id: int, owner: int, direction: int) -> Dictionary:
    return {"id": id, "owner": owner, "direction": direction, "attack": 1, "health": 4}
func _initialize() -> void:
    var game = Core.new()
    game.start(42)
    game.state.players[0].coins = 3
    game.state.players[0].hand = []
    game.state.board[4] = unit(1, 0, 0)
    game.state.board[1] = unit(0, 1, 0)
    game.state.board[3] = unit(0, 0, 1)
    var view: Dictionary = MatchView.for_player(game, 0)
    var command: Dictionary = Driver.safe_command(view)
    check(command.type == "pass", "enemy primary target cannot conceal allied splash")
    game.state.board[3] = null
    view = MatchView.for_player(game, 0)
    command = Driver.safe_command(view)
    check(command.type == "attack" and int(command.source) == 4, "safe sweep is retained")
    game.state.players[0].hand = [0]
    view = MatchView.for_player(game, 0)
    check(Driver.safe_command(view).type == "play", "placement remains preferred")
    game.state.players[0].hand = []
    for facing in range(4):
        for ally_cell in range(9):
            if ally_cell in [1, 4]:
                continue
            for cell in range(9):
                game.state.board[cell] = null
            game.state.board[4] = unit(1, 0, facing)
            game.state.board[1] = unit(0, 1, 0)
            game.state.board[ally_cell] = unit(0, 0, 0)
            view = MatchView.for_player(game, 0)
            command = Driver.safe_command(view)
            check(command in view.legal, "automation uses legal commands")
            if command.type == "attack":
                for target in game.attack_targets(int(command.source), view.board[int(command.source)], view.board):
                    check(view.board[target].owner == 1, "automatic sweep never requires friendly-fire consent")
    if failures == 0:
        print("MULTIMENTAL_ROOM_AUTOMATION_PASS checks=%d" % checks)
    quit(0 if failures == 0 else 1)
