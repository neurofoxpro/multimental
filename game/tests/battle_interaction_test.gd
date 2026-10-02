extends SceneTree
const Intent = preload("res://src/battle_interaction.gd")
var checks: int = 0
var failures: int = 0
func check(value: bool, name: String) -> void:
    checks += 1
    if not value:
        failures += 1
        printerr("INTERACTION_FAIL " + name)
func _initialize() -> void:
    call_deferred("run_test")
func settle() -> void:
    for i in range(4):
        await process_frame
func fixture(ui, with_units: bool = true) -> void:
    ui.game.start(42)
    ui.game.state.active = 0
    ui.game.state.center_unlocked = true
    ui.game.state.players[0].coins = 10
    ui.game.state.players[0].hand = [0,1,2,3,4,5]
    ui.game.state.board.fill(null)
    if with_units:
        var archer_id: int = -1
        for id in range(ui.Core.CARD_COUNT):
            if ui.game.card(id).kind == "archer":
                archer_id = id
                break
        check(archer_id >= 0,"catalog provides an archer fixture")
        ui.game.state.board[0] = {"id":archer_id,"owner":0,"attack":1,"health":3,"direction":1}
        ui.game.state.board[1] = {"id":0,"owner":0,"attack":1,"health":3,"direction":0}
        ui.game.state.board[2] = {"id":0,"owner":1,"attack":1,"health":3,"direction":3}
    ui.selected_hand = -1
    ui.selected_unit = -1
    ui.selected_direction = 0
    ui.refresh()
func click_at(point: Vector2) -> void:
    var motion := InputEventMouseMotion.new()
    motion.position = point
    motion.global_position = point
    root.push_input(motion,true)
    await process_frame
    for pressed in [true,false]:
        var event := InputEventMouseButton.new()
        event.position = point
        event.global_position = point
        event.button_index = MOUSE_BUTTON_LEFT
        event.pressed = pressed
        event.button_mask = MOUSE_BUTTON_MASK_LEFT if pressed else 0
        root.push_input(event,true)
    await settle()
func run_test() -> void:
    root.gui_embed_subwindows = true
    root.content_scale_size = Vector2i(720,1280)
    root.size = Vector2i(720,1280)
    var ui = load("res://src/main.tscn").instantiate()
    ui.profile.enabled = false
    root.add_child(ui)
    ui.set_process(false)
    ui.start_match()
    await settle()
    for language in ["ru","en"]:
        ui.language = language
        fixture(ui)
        await settle()
        var before: String = ui.game.digest()
        var view: Dictionary = ui._view()
        var exact: Dictionary = view.duplicate(true)
        var preview: Dictionary = Intent.attack(view,0)
        check(preview.targets == [1,2] and preview.allies == 1 and preview.enemies == 1 and preview.cost == 1, "preview uses the actual full sweep, not one clicked target")
        check(not preview.command.is_empty() and preview.command in view.legal and view == exact, "intent returns a legal copied command without changing public view")
        check(Intent.attack(view,2).command.is_empty(), "enemy cannot become controllable")
        check(Intent.cell(view,-1,-1,-1,0).kind == "none", "bad cell index ignored")
        check(Intent.cell({},0,-1,-1,0).kind == "none", "no view has no action")
        ui.on_cell(0)
        check(ui.selected_unit == 0 and ui.game.digest() == before, "choosing own figure doesn't attack")
        ui.on_cell(1)
        check(ui.selected_unit == 1 and ui.game.digest() == before and not ui.friendly_confirm.visible, "changing to another own figure is selection, never friendly fire")
        ui.on_cell(2)
        await settle()
        check(ui.battle_inspector.visible and ui.battle_inspector.current_id == 0 and ui.game.digest() == before, "enemy tap inspects without spending the turn")
        ui.battle_inspector.hide()
        await settle()
        ui.on_cell(0)
        ui.attack_selected()
        check(ui.friendly_confirm.visible and ui.game.digest() == before, "explicit attack retains the ally confirmation")
        ui.friendly_confirm.canceled.emit()
        ui.friendly_confirm.hide()
        check(ui.friendly_pending.is_empty() and ui.game.digest() == before, "cancelled ally warning spends nothing")
        ui.attack_selected()
        ui.confirm_friendly_attack()
        check(ui.game.commands.size() == 1 and ui.game.state.board[1].health == 2 and ui.game.state.board[2].health == 2, "one explicit confirmed attack applies the real multi-target command once")
        check(ui.game.state.players[0].coins == 9 and ui.game.state.active == 1, "domain cost and turn progression are preserved")
        ui.attack_selected()
        check(ui.game.commands.size() == 1, "second activation has no stale selected source")
        fixture(ui)
        ui.on_cell(0)
        ui.attack_selected()
        check(ui.friendly_confirm.visible, "stale warning fixture starts with explicit intent")
        check(ui.game.apply(0,{"type":"pass"}).ok, "fixture advances the first turn")
        ui.after_action()
        check(not ui.friendly_confirm.visible and ui.friendly_pending.is_empty(), "a turn change dismisses the obsolete ally warning")
        check(ui.game.apply(1,{"type":"pass"}).ok, "fixture returns control to the player")
        ui.after_action()
        before = ui.game.digest()
        var recorded: int = ui.game.commands.size()
        ui.confirm_friendly_attack()
        check(ui.game.digest() == before and ui.game.commands.size() == recorded, "obsolete confirmation cannot attack during a later turn")
        fixture(ui)
        ui.on_cell(0)
        ui.attack_selected()
        check(ui.game.apply(0,{"type":"pass"}).ok and ui.game.apply(1,{"type":"pass"}).ok, "fixture changes state before the next render")
        before = ui.game.digest()
        ui.confirm_friendly_attack()
        check(ui.game.digest() == before, "confirmation revalidates state even before a render")
        for changed in ["board","coins","revision","pending","phase"]:
            fixture(ui)
            ui.online = changed in ["revision","pending","phase"]
            if ui.online:
                ui.lan.connection_status = "connected"
                ui.lan.current_view = MatchView.for_player(ui.game,0)
                ui.lan.current_view["phase"] = "playing"
                ui.lan.current_view["revision"] = 1
                ui.lan.current_view["turn_remaining_ms"] = 30000
                ui.lan.view_received_at = Time.get_ticks_msec()
                ui.lan.pending = {}
            ui.on_cell(0)
            ui.attack_selected()
            ui.refresh()
            check(ui.friendly_confirm.visible and ui._friendly_confirmation_current(ui._view()), "unchanged refresh keeps current consent: " + changed)
            match changed:
                "board":
                    ui.game.state.board[1].health -= 1
                "coins":
                    ui.game.state.players[0].coins -= 1
                "revision":
                    ui.lan.current_view.revision += 1
                "pending":
                    ui.lan.pending = {"fixture":"unacknowledged"}
                "phase":
                    ui.lan.current_view.phase = "reconnecting"
            check(not ui._friendly_confirmation_current(ui._view()), "changed public context invalidates consent: " + changed)
            before = ui.game.digest()
            var pending_before: Dictionary = ui.lan.pending.duplicate(true)
            ui.confirm_friendly_attack()
            check(ui.game.digest() == before and ui.lan.pending == pending_before and ui.friendly_pending.is_empty(), "obsolete consent cannot submit: " + changed)
            ui.online = false
            ui.lan.pending = {}
            ui.lan.current_view = {}
        fixture(ui,false)
        await settle()
        var hand_scroll: ScrollContainer = ui.find_child("HandScroll",true,false)
        hand_scroll.scroll_horizontal = 70
        await settle()
        var card = ui.hand_row.get_child(2)
        await click_at(card.get_global_rect().position + Vector2(60,58))
        check(ui.selected_hand == 2 and ui.game.commands.is_empty(), "real mouse hit on card selects, no domain command yet: selected=" + str(ui.selected_hand) + " disabled=" + str(card.disabled) + " rect=" + str(card.get_global_rect()))
        var slots: Array[int] = []
        for child in ui.hand_row.get_children():
            slots.append(child.get_instance_id())
        card.grab_focus()
        var offset: int = hand_scroll.scroll_horizontal
        before = ui.game.digest()
        ui.rotate_card(1)
        await settle()
        check(ui.game.digest() == before and ui.selected_direction == 1, "rotation previews without changing game")
        check(hand_scroll.scroll_horizontal == offset and card.has_focus(), "rotation preserves focus and hand scroll")
        for index in range(slots.size()):
            check(ui.hand_row.get_child(index).get_instance_id() == slots[index], "unchanged hand slots are not recreated")
        var command: Dictionary = {}
        for candidate in ui._view().legal:
            if candidate.type == "play" and candidate.hand == 2:
                command = candidate.duplicate(true)
                command.direction = 1
                break
        check(not command.is_empty(), "real legal placement fixture")
        if not command.is_empty():
            await click_at(ui.board_buttons[int(command.cell)].get_global_rect().get_center())
            check(ui.game.commands.size() == 1 and ui.game.state.board[int(command.cell)].direction == 1, "second actual hit deploys the selected oriented card")
        fixture(ui,false)
        ui.game.state.active = 1
        ui.refresh()
        await settle()
        card = ui.hand_row.get_child(0)
        hand_scroll.scroll_horizontal = 0
        await settle()
        check(card.disabled and not card.details.disabled, "unavailable gameplay doesn't disable the independent detail action")
        before = ui.game.digest()
        await click_at(card.details.get_global_rect().get_center())
        check(ui.battle_inspector.visible and ui.battle_inspector.current_id == int(ui.game.state.players[0].hand[0]), "real click can read a disabled card without mouse hover")
        check(ui.game.digest() == before and ui.selected_hand == -1, "inspection on enemy turn has no game effect")
        ui.battle_inspector.hide()
        await settle()
        check(card.details.has_focus(), "details close restores the exact prior input target")
        fixture(ui)
        ui.on_hand(0)
        before = ui.game.digest()
        ui.cancel_battle_selection()
        check(ui.selected_hand == -1 and ui.selected_unit == -1 and ui.game.digest() == before, "explicit selection cancel is reversible UI-only state")
        ui.on_cell(0)
        var event := InputEventAction.new()
        event.action = "ui_cancel"
        event.pressed = true
        root.push_input(event,true)
        await settle()
        check(ui.selected_unit == -1 and ui.game.digest() == before, "keyboard/controller cancel action clears selection before exit")
        var network_view: Dictionary = ui._view().duplicate(true)
        ui.online = true
        ui.lan.current_view = network_view
        ui.lan.pending = {"fixture":"unacknowledged"}
        check(Intent.attack(network_view,0,true).command.is_empty(), "unacknowledged network input doesn't permit another attack")
        ui.on_cell(0)
        check(ui.game.digest() == before and ui.selected_unit == -1, "pending network input only permits inspection")
        ui.battle_inspector.hide()
        ui.online = false
        ui.lan.pending = {}
        ui.lan.current_view = {}
    ui.show_menu()
    ui.queue_free()
    await settle()
    if failures == 0:
        print("MULTIMENTAL_INTERACTION_PASS checks=" + str(checks) + " actual_pointer_events=true physical_device=false")
    quit(0 if failures == 0 else 1)
