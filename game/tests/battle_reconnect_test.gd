extends SceneTree
const Fixture = preload("res://tests/support/battle_gallery_fixture.gd")
var checks: int = 0
var failures: int = 0
func check(ok: bool, name: String) -> void:
    checks += 1
    if not ok:
        failures += 1
        printerr("RECONNECT_UI_FAIL " + name)
func _initialize() -> void:
    call_deferred("run_test")
func run_test() -> void:
    root.gui_embed_subwindows = true
    root.size = Vector2i(720,1280)
    var ui = load("res://src/main.tscn").instantiate()
    ui.profile.enabled = false
    root.add_child(ui)
    ui.set_process(false)
    for locale in ["ru","en"]:
        ui.language = locale
        check(Fixture.show(ui,"battle-reconnecting"),"real disconnect signal disables cached actions " + locale)
        check(ui.end_turn_button.disabled,"cannot end turn on stale network view")
        var first = ui.hand_row.get_child(0)
        check(first.disabled and not first.details.disabled,"cards remain inspectable but not playable")
        ui.on_hand(0)
        check(ui.selected_hand == -1 and ui.battle_inspector.visible,"stale hand selection opens details without choosing deployment")
        ui.battle_inspector.hide()
        ui.on_cell(0)
        check(ui.selected_unit == -1 and ui.battle_inspector.visible,"stale friendly unit is inspected, not selected for attack")
        ui.battle_inspector.hide()
        var before: String = ui.game.digest()
        ui.selected_unit = 0
        ui.attack_selected()
        check(not ui.friendly_confirm.visible and ui.friendly_pending.is_empty(),"direct attack cannot create consent while disconnected")
        ui.selected_unit = -1
        ui.lan._status("connected")
        check(not ui.end_turn_button.disabled and not first.disabled,"transport recovery restores actions without a domain command")
        ui.on_cell(0)
        ui.attack_selected()
        check(ui.friendly_confirm.visible,"connected attack requests explicit ally consent")
        ui.lan._status("reconnecting")
        check(not ui.friendly_confirm.visible and ui.friendly_pending.is_empty(),"transport-only change invalidates consent without changing revision")
        ui.confirm_friendly_attack()
        check(ui.game.digest() == before and ui.lan.pending.is_empty(),"disconnect and stale callback submit nothing")
    ui.online = false
    ui.show_menu()
    ui.queue_free()
    await process_frame
    print("MULTIMENTAL_RECONNECT_UI_RESULT checks="+str(checks)+" failures="+str(failures))
    if failures == 0:
        print("MULTIMENTAL_RECONNECT_UI_PASS physical_radio=false")
    quit(0 if failures == 0 else 1)
