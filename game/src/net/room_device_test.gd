extends Node
## Bounded debug harness: same player lobby/session handlers, no direct core mutation.
signal changed(value: Dictionary)
signal completed(value: Dictionary)
var ui: Control
var request: Dictionary
var role: String
var started: int = 0
var deadline: int = 0
var next_action: int = 0
var actions: int = 0
var reconnect_attempted: bool = false
var reconnect_confirmed: bool = false
var connected_before: bool = false
var finished: bool = false
var complete_after: int = 0
func _ready() -> void:
    if not OS.is_debug_build() or request.get("nonce", "").length() < 24:
        _finish({"status": "failed", "error": "test_not_authorized"})
        return
    started = Time.get_ticks_msec()
    deadline = started + 90000
    role = "host" if request.get("mode") == "pvp-host" else "guest"
    call_deferred("_start")
func _start() -> void:
    ui.show_lan_menu()
    var result: Dictionary
    if role == "host":
        result = ui.create_lan_room(str(request.get("address", "127.0.0.1")), 17844)
    else:
        result = ui.join_lan_room(str(request.get("invitation", "")))
    if not result.ok:
        _finish({"status": "failed", "error": str(result.error)})
        return
    changed.emit({"stage": "room_created" if role == "host" else "room_connecting", "invitation": ui.lan.invitation if role == "host" else "", "role": role})
func _process(_delta: float) -> void:
    if finished or started == 0:
        return
    var now: int = Time.get_ticks_msec()
    if now > deadline:
        _finish({"status": "failed", "error": "pvp_match_timeout", "connection": ui.lan.connection_status})
        return
    var view: Dictionary = ui.lan.current_view
    if view.is_empty() or view.get("phase") == "waiting":
        return
    if view.has("players") or view.has("seed") or view.has("deck") or view.has("secret"):
        _finish({"status": "failed", "error": "private_state_leak"})
        return
    if ui.lan.connection_status == "connected":
        if reconnect_attempted:
            reconnect_confirmed = true
        connected_before = true
    if int(view.winner) != -1:
        if complete_after == 0:
            complete_after = now + 1200
        if now >= complete_after:
            var ok: bool = actions > 0 and connected_before and (role == "host" or reconnect_confirmed)
            _finish({"status": "passed" if ok else "failed", "role": role, "winner": int(view.winner), "reason": str(view.reason), "actions": actions, "turn": int(view.turn), "scores": view.scores, "reconnect": reconnect_confirmed if role == "guest" else true, "tls": true, "private_view": true, "input_source": "player_ui_handlers_over_real_network"})
        return
    if role == "guest" and not reconnect_attempted and int(view.turn) >= 3 and ui.lan.connection_status == "connected":
        reconnect_attempted = true
        ui.lan.interrupt_for_test()
        next_action = now + 1500
        return
    if now < next_action or not ui.battle or ui.lan.connection_status != "connected" or int(view.active) != 0 or not ui.lan.pending.is_empty():
        return
    var options: Array = view.legal
    if options.is_empty():
        return
    var command: Dictionary = options[0]
    if command.type == "play":
        ui.selected_hand = -1
        ui.on_hand(int(command.hand))
        ui.on_cell(int(command.cell))
    elif command.type == "attack":
        ui.selected_hand = -1
        ui.selected_unit = -1
        ui.on_cell(int(command.source))
        ui.on_cell(int(command.target))
    else:
        ui.pass_turn()
    actions += 1
    next_action = now + 250
func _finish(value: Dictionary) -> void:
    if finished:
        return
    finished = true
    value.invitation = ""
    value.duration_ms = Time.get_ticks_msec() - started
    value.scope = "player_lan_room_two_android_instances"
    completed.emit(value)
