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
    check(ui.battle and ui.board_buttons.size() == 9, "nine interactive cells")
    if ui.game.state.active == 1:
        ui.game.apply(1, ui.game.choose_ai())
        ui.refresh()
    var turn_before: int = ui.game.state.turn
    for action in ui.game.legal(0):
        if action.type == "play":
            ui.on_hand(action.hand)
            ui.on_cell(action.cell)
            break
    check(ui.game.state.turn > turn_before, "card selection and target execute action")
    check(ui.game.count_cells(0) == 1, "human unit appears")
    ui.show_menu()
    check(not ui.battle, "return to menu")
    ui.queue_free()
    await process_frame
    if failures == 0:
        print("MULTIMENTAL_UI_PASS")
    quit(0 if failures == 0 else 1)
