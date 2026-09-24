class_name MatchView
extends RefCounted
## One player-facing projection reused by offline UI and authoritative rooms.
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
        "scores": [core.count_cells(player), core.count_cells(1 - player)], "legal": core.legal(player)}
