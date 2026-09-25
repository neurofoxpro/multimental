extends SceneTree
var failures: int = 0
func _initialize() -> void:
    call_deferred("run_test")
func check(value: bool, message: String) -> void:
    if not value:
        failures += 1
        printerr("PRODUCTION_TEST_FAIL: " + message)
func run_test() -> void:
    var packed := load("res://src/main.tscn") as PackedScene
    var ui = packed.instantiate()
    root.add_child(ui)
    await process_frame
    check(not ui.battle, "menu visible initially")
    ui.toggle_language()
    ui.start_match()
    # UI startup intentionally uses real time for real players. The test must
    # replace that random initial state with a reproducible domain fixture.
    ui.game.start(42)
    ui.refresh()
    check(ui.battle and ui.board_buttons.size() == 9, "nine interactive cells")
    check(ui.game.state.active == 0, "fixture starts on the human turn")
    var turn_before: int = ui.game.state.turn
    var played: bool = false
    for action in ui.game.legal(0):
        if action.type == "play":
            ui.on_hand(action.hand)
            ui.on_cell(action.cell)
            played = true
            break
    check(played, "fixture contains an affordable playable card")
    check(ui.game.state.turn == turn_before and int(ui.game.state.placed_cell) >= 0, "placement retains optional attack phase")
    check(ui.game.count_cells(0) == 1, "human unit appears")

    # A legitimate opening hand can have only cost-2 cards and one coin.
    # Such a player must be able to pass; the smoke test must not invent a play.
    ui.game.start(42)
    ui.game.state.players[0].hand = [1, 3, 5]
    ui.game.state.players[0].coins = 1
    ui.selected_hand = -1
    ui.selected_unit = -1
    ui.refresh()
    var playable: int = 0
    for action in ui.game.legal(0):
        if action.type == "play":
            playable += 1
    check(playable == 0, "expensive-only hand has no affordable play")
    for card_button in ui.hand_row.get_children():
        check(card_button.disabled, "unaffordable card button is disabled")
    turn_before = ui.game.state.turn
    ui.pass_turn()
    check(ui.game.state.turn > turn_before, "pass works without affordable cards")
    check(ui.game.count_cells(0) == 0, "pass does not place a unit")
    ui.show_menu()
    check(not ui.battle, "return to menu")
    ui.queue_free()
    await process_frame
    if failures == 0:
        print("MULTIMENTAL_UI_PASS")
    quit(0 if failures == 0 else 1)
