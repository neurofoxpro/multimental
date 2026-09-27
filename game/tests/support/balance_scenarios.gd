extends RefCounted
## Shared deterministic scenario/policy helpers, not production gameplay rules.
const Core=preload("res://src/match_core.gd")
static func deck(name: String) -> Array[int]:
    var cards: Array[int] = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 0]
    match name:
        "guard": cards.append_array([1, 9, 1, 9])
        "lancer": cards.append_array([3, 11, 3, 11])
        "archer": cards.append_array([5, 13, 5, 13])
        "flanker": cards.append_array([7, 15, 7, 15])
        "rush": cards.append_array([2, 4, 6, 8])
        "elite": cards = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 1, 3, 20, 23, 26]
        _: cards = Core.STARTER.duplicate()
    return cards
static func choose(g, policy: String, rng: RandomNumberGenerator) -> Dictionary:
    if policy == "greedy":
        return g.choose_ai()
    var actor: int = int(g.state.active)
    var best: Dictionary = {"type": "pass"}
    var score_best: float = -100.0
    for action in g.legal(actor):
        var variants: int = 4 if action.type == "play" else 1
        for facing in range(variants):
            var score: float = -100.0
            var candidate: Dictionary = action.duplicate()
            if action.type == "play":
                candidate.direction = facing
                var card: Dictionary = g.card(int(g.state.players[actor].hand[int(action.hand)]))
                var dummy: Dictionary = {"id": card.id, "direction": facing}
                score = 95.0 + card.attack * 3 + card.health * 2 - card.cost
                if g.count_cells(actor) == 4:
                    score += 10000
                if int(card.element) == int(g.state.terrain[int(action.cell)]):
                    score += 12
                for target in g.attack_cells(int(action.cell), dummy, g.state.board):
                    var other: Variant = g.state.board[target]
                    score += 3 if other == null else (30 if int(other.owner) != actor else -18)
                for source in range(9):
                    var other: Variant = g.state.board[source]
                    if other != null and int(other.owner) != actor and int(action.cell) in g.attack_cells(source, other, g.state.board):
                        score -= 25 if int(other.attack) >= int(card.health) else 6
            elif action.type == "attack":
                score = 0.0
                var own: Dictionary = g.state.board[int(action.source)]
                var counters: int = 0
                for target in g.attack_targets(int(action.source), own, g.state.board):
                    var other: Dictionary = g.state.board[target]
                    var lethal: bool = int(other.health) <= int(own.attack)
                    if int(other.owner) == actor:
                        score -= 200 if lethal else 80
                    else:
                        score += 120 if lethal else 20
                        if lethal and g.count_cells(1 - actor) >= 4:
                            score += 700
                        if not lethal and int(action.source) in g.attack_cells(target, other, g.state.board):
                            counters += int(other.attack)
                if counters >= int(own.health):
                    score -= 95
            score += rng.randf() * 0.25
            if score > score_best:
                score_best = score
                best = candidate
    return best
