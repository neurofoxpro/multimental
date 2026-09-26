class_name MatchView
extends RefCounted
## Same coordinates and directions on both screens; ownership is player-relative.
static func for_player(core, player: int) -> Dictionary:
    if player not in [0, 1] or core.state.is_empty():
        return {}
    var me: Dictionary = core.state.players[player]
    var other: Dictionary = core.state.players[1 - player]
    var board: Array = core.state.board.duplicate(true)
    for unit in board:
        if unit != null:
            unit.owner = 0 if int(unit.owner) == player else 1
    var winner: int = int(core.state.winner)
    if winner in [0, 1]:
        winner = 0 if winner == player else 1
    return {"board": board, "hand": me.hand.duplicate(), "coins": me.coins,
        "deck_count": me.deck.size(), "opponent_hand_count": other.hand.size(),
        "opponent_deck_count": other.deck.size(), "active": 0 if int(core.state.active) == player else 1,
        "turn": core.state.turn, "winner": winner, "reason": core.state.reason,
        "placed_cell": core.state.placed_cell, "event_id": core.state.event_id,
        "events": core.state.events.duplicate(true),
        "terrain": core.state.terrain.duplicate(), "center_unlocked": core.center_available(), "income_bonus": core.state.income_bonus,
        "scores": [core.count_cells(player), core.count_cells(1 - player)], "legal": core.legal(player)}
