extends RefCounted
## Synthetic public-state fixtures for rendering and UI tests, never balance evidence.
const STATES: Array[String] = ["battle-card","battle-unit","battle-allies","battle-opponent","battle-reconnecting","battle-result"]
static func unit(ui, id: int, owner: int, direction: int) -> Dictionary:
    var card: Dictionary = ui.game.card(id)
    return {"id":id,"owner":owner,"direction":direction,"attack":card.attack,"health":card.health}
static func show(ui, page: String) -> bool:
    if page not in STATES:
        return false
    ui.online = false
    ui.start_match(true)
    ui.game.start(42)
    ui.game.state.active = 0
    ui.game.state.turn = 7
    ui.game.state.center_unlocked = true
    ui.game.state.players[0].coins = 10
    ui.game.state.players[0].hand = [0,1,2,3,4,5]
    ui.game.state.board.fill(null)
    var archer: int = -1
    var longest: int = 0
    for id in range(ui.Core.CARD_COUNT):
        if ui.game.card(id).kind == "archer" and archer == -1:
            archer = id
        if str(ui.game.card(id).ru).length() > str(ui.game.card(longest).ru).length():
            longest = id
    if archer == -1:
        return false
    ui.game.state.board[0] = unit(ui,archer,0,1)
    ui.game.state.board[1] = unit(ui,longest,0,0)
    ui.game.state.board[2] = unit(ui,0,1,3)
    ui.refresh()
    match page:
        "battle-card": ui.on_hand(0)
        "battle-unit": ui.on_cell(0)
        "battle-allies":
            ui.on_cell(0)
            ui.attack_selected()
        "battle-opponent":
            ui.game.state.active = 1
            ui.refresh()
        "battle-reconnecting":
            var view: Dictionary = ui._view().duplicate(true)
            view["phase"] = "playing"
            view["revision"] = 1
            view["turn_remaining_ms"] = 30000
            ui.lan.current_view = view
            ui.lan.view_received_at = Time.get_ticks_msec()
            ui.lan.connection_status = "connected"
            ui.online = true
            # The real transport preserves its last public view when this signal fires.
            ui.lan._status("reconnecting")
        "battle-result":
            for index in [3,6,7]:
                ui.game.state.board[index] = unit(ui,0,0,0)
            ui.game.state.winner = 0
            ui.game.state.reason = "five"
            ui.refresh()
    return matches(ui,page) and ui.game.commands.is_empty()
static func matches(ui, page: String) -> bool:
    match page:
        "battle-card": return ui.selected_hand == 0 and ui.rotation_left.visible
        "battle-unit": return ui.selected_unit == 0 and ui.sweep_button.visible and not ui.sweep_button.disabled
        "battle-allies": return ui.friendly_confirm.visible and not ui.friendly_pending.is_empty()
        "battle-opponent": return ui._view().active == 1 and ui.end_turn_button.disabled
        "battle-reconnecting": return ui.lan.connection_status == "reconnecting" and ui.end_turn_button.disabled and ui.hand_row.get_child(0).disabled
        "battle-result": return ui._view().winner == 0 and ui.end_turn_button.disabled
    return false
