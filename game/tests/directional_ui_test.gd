extends SceneTree
const Core = preload("res://src/match_core.gd")
var failures: int = 0
var checks: int = 0
func check(value: bool, message: String) -> void:
    checks += 1
    if not value:
        failures += 1
        printerr("PRODUCTION_TEST_FAIL: " + message)
func _initialize() -> void:
    call_deferred("run_test")
func fixture(ui) -> void:
    ui.game.start(42)
    ui.game.state.players[0].hand = [0, 2, 4]
    ui.game.state.players[0].coins = 3
    ui.selected_hand = -1
    ui.selected_unit = -1
    ui.selected_direction = 0
    ui.last_animated_event = -1
    ui.timed_turn = int(ui.game.state.turn)
    ui.refresh()
func run_test() -> void:
    var ui = load("res://src/main.tscn").instantiate()
    root.add_child(ui)
    await process_frame
    ui.set_process(false)
    ui.start_match()
    ui.set_process(false)
    fixture(ui)
    ui.game.state.board[1] = {"id": 2, "owner": 1, "attack": 1, "health": 4, "direction": 0}
    ui.refresh()
    var digest: String = ui.game.digest()
    ui.on_hand(0)
    ui.rotate_card(1)
    check(ui.selected_direction == 1 and ui.game.digest() == digest, "rotation preview never mutates the match")
    check("→" in ui.aim_label.text, "preview shows chosen direction")
    var deadline: float = ui.deadline
    ui.on_cell(0)
    check(ui.game.state.board[0].direction == 1 and ui.game.state.active == 0, "oriented placement retains turn")
    check(ui.deadline == deadline, "UI does not renew timer after placement")
    check(ui.rotation_left.disabled and ui.rotation_right.disabled, "rotation disabled after placement")
    for b in ui.hand_row.get_children():
        check(b.disabled, "second summon disabled in UI")
    ui.rotate_card(1)
    check(ui.game.state.board[0].direction == 1, "no rotation of a deployed card")
    var damage_before: int = ui.damage_effects_total
    ui.on_cell(0)
    ui.on_cell(1)
    check(ui.game.state.board[1].health == 3 and ui.game.state.active == 1, "new unit attacks at user request")
    check(ui.damage_effects_total == damage_before + 1, "damage visualization invoked")
    check(ui.board_buttons[1].find_child("DamageNumber", true, false) != null, "damage number attached to target")
    ui.refresh()
    check(ui.damage_effects_total == damage_before + 1, "refresh does not duplicate damage animation")
    fixture(ui)
    ui.game.state.board[0] = {"id": 0, "owner": 0, "attack": 1, "health": 3, "direction": 1}
    ui.game.state.board[1] = {"id": 2, "owner": 0, "attack": 1, "health": 3, "direction": 3}
    ui.refresh()
    ui.on_cell(0)
    digest = ui.game.digest()
    ui.on_cell(1)
    check(ui.friendly_confirm.visible and ui.game.digest() == digest, "friendly fire asks before applying")
    ui.confirm_friendly_attack()
    check(ui.game.state.board[1].health == 2 and ui.game.state.board[0].health == 3, "confirmed friendly damage applied")
    check(ui.game.state.players[0].coins == 2, "old attacker fee shown and charged")
    fixture(ui)
    ui.on_hand(0)
    ui.on_cell(4)
    ui.pass_turn()
    check(ui.game.state.active == 1 and ui.game.state.board[4] != null, "optional attack can be skipped with End Turn")
    ui.show_card_guide()
    check(not ui.battle, "catalogue guide screen opens")
    ui.show_menu()
    ui.queue_free()
    await process_frame
    if failures == 0:
        print("MULTIMENTAL_DIRECTIONAL_UI_PASS checks=%d" % checks)
    quit(0 if failures == 0 else 1)
