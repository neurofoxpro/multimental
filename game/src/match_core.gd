class_name MatchCore
extends RefCounted
## Provisional offline alpha rules. No Node, network, frame or clock dependencies.
const ELEMENTS: Array[String] = ["fire", "water", "lightning", "air", "earth"]
const NAMES_RU: Array[String] = ["Искра", "Пламя", "Капля", "Прилив", "Разряд", "Гроза", "Ветер", "Вихрь", "Камень", "Скала"]
const NAMES_EN: Array[String] = ["Spark", "Flame", "Drop", "Tide", "Bolt", "Storm", "Breeze", "Gust", "Stone", "Rock"]
var state: Dictionary = {}
var commands: Array[Dictionary] = []
var random_state: int = 1
var initial_seed: int = 1

func card(id: int) -> Dictionary:
    var heavy: bool = id % 2 == 1
    return {"id": id, "element": id / 2, "ru": NAMES_RU[id], "en": NAMES_EN[id], "cost": 2 if heavy else 1, "attack": 2 if heavy else 1, "health": 3 if heavy else 2}

func next_random(maximum: int) -> int:
    random_state = (random_state * 48271) % 2147483647
    return random_state % maximum

func start(seed_value: int) -> void:
    initial_seed = maxi(1, seed_value % 2147483647)
    random_state = initial_seed
    commands.clear()
    state = {"active": next_random(2), "turn": 1, "winner": -1, "reason": "", "players": [], "board": []}
    for i in range(9):
        state.board.append(null)
    for player in range(2):
        var deck: Array[int] = []
        for i in range(15):
            deck.append(i % 10)
        for i in range(deck.size() - 1, 0, -1):
            var j: int = next_random(i + 1)
            var temp: int = deck[i]
            deck[i] = deck[j]
            deck[j] = temp
        var hand: Array[int] = []
        for i in range(4):
            hand.append(deck.pop_back())
        state.players.append({"deck": deck, "hand": hand, "coins": 1, "maximum": 1, "missed": 0})
    _draw(int(state.active))

func count_cells(player: int) -> int:
    var count: int = 0
    for unit in state.board:
        if unit != null and int(unit.owner) == player:
            count += 1
    return count

func adjacent(a: int, b: int) -> bool:
    return absi(a % 3 - b % 3) + absi(int(a / 3) - int(b / 3)) == 1

func legal(player: int) -> Array[Dictionary]:
    var result: Array[Dictionary] = []
    if int(state.winner) != -1 or int(state.active) != player:
        return result
    var p: Dictionary = state.players[player]
    for hand_index in range(p.hand.size()):
        var def: Dictionary = card(int(p.hand[hand_index]))
        if int(def.cost) <= int(p.coins):
            for cell in range(9):
                if state.board[cell] == null:
                    result.append({"type": "play", "hand": hand_index, "cell": cell})
    for source in range(9):
        var unit: Variant = state.board[source]
        if unit == null or int(unit.owner) != player:
            continue
        for target in range(9):
            var enemy: Variant = state.board[target]
            if enemy != null and int(enemy.owner) != player and adjacent(source, target):
                result.append({"type": "attack", "source": source, "target": target})
    result.append({"type": "pass"})
    return result

func apply(player: int, command: Dictionary) -> Dictionary:
    if int(state.winner) != -1:
        return {"ok": false, "error": "finished"}
    if player != int(state.active):
        return {"ok": false, "error": "wrong_turn"}
    var valid: bool = false
    for c in legal(player):
        if c == command:
            valid = true
            break
    if not valid:
        return {"ok": false, "error": "invalid_target"}
    var p: Dictionary = state.players[player]
    var events: Array[Dictionary] = []
    if command.type == "play":
        var id: int = int(p.hand[int(command.hand)])
        var def: Dictionary = card(id)
        p.hand.remove_at(int(command.hand))
        p.coins = int(p.coins) - int(def.cost)
        state.board[int(command.cell)] = {"id": id, "owner": player, "attack": int(def.attack), "health": int(def.health)}
        events.append({"type": "unit_placed", "cell": int(command.cell)})
    elif command.type == "attack":
        var a: Dictionary = state.board[int(command.source)]
        var b: Dictionary = state.board[int(command.target)]
        a.health = int(a.health) - int(b.attack)
        b.health = int(b.health) - int(a.attack)
        events.append({"type": "combat", "source": int(command.source), "target": int(command.target)})
        if int(a.health) <= 0:
            state.board[int(command.source)] = null
        if int(b.health) <= 0:
            state.board[int(command.target)] = null
    p.missed = 0
    commands.append({"player": player, "command": command.duplicate(true)})
    _finish_turn()
    return {"ok": true, "events": events}

func timeout(player: int) -> void:
    if state.winner != -1 or int(state.active) != player:
        return
    var p: Dictionary = state.players[player]
    p.missed = int(p.missed) + 1
    commands.append({"player": player, "command": {"type": "timeout"}})
    if int(p.missed) >= 2:
        state.winner = 1 - player
        state.reason = "timeout"
    else:
        _finish_turn()

func end_on_time_limit() -> void:
    if state.winner != -1:
        return
    commands.append({"player": int(state.active), "command": {"type": "limit"}})
    state.winner = 2 if count_cells(0) == count_cells(1) else (0 if count_cells(0) > count_cells(1) else 1)
    state.reason = "limit"

func _draw(player: int) -> void:
    var p: Dictionary = state.players[player]
    if not p.deck.is_empty():
        p.hand.append(p.deck.pop_back())

func _finish_turn() -> void:
    # Resolve effects first, then victory. Empty hand AND deck loses, even with units.
    for player in range(2):
        if count_cells(player) >= 5:
            state.winner = player
            state.reason = "five"
            return
    for player in range(2):
        var p: Dictionary = state.players[player]
        if p.hand.is_empty() and p.deck.is_empty():
            state.winner = 1 - player
            state.reason = "empty"
            return
    state.active = 1 - int(state.active)
    state.turn = int(state.turn) + 1
    var next: Dictionary = state.players[int(state.active)]
    next.maximum = mini(6, 1 + int((int(state.turn) - 1) / 2))
    next.coins = int(next.maximum)
    _draw(int(state.active))

func choose_ai() -> Dictionary:
    var options: Array[Dictionary] = legal(int(state.active))
    var best: Dictionary = {"type": "pass"}
    var best_score: int = -100000
    for command in options:
        var score: int = -100
        if command.type == "play":
            score = 100 + (8 if int(command.cell) == 4 else 0)
            if count_cells(int(state.active)) == 4:
                score += 10000
        elif command.type == "attack":
            var a: Dictionary = state.board[int(command.source)]
            var b: Dictionary = state.board[int(command.target)]
            score = 30
            if int(b.health) <= int(a.attack):
                score += 90
                if count_cells(1 - int(state.active)) >= 4:
                    score += 500
            if int(a.health) <= int(b.attack):
                score -= 70
        if score > best_score:
            best_score = score
            best = command
    return best

func replay(seed_value: int, journal: Array[Dictionary]) -> void:
    start(seed_value)
    for entry in journal:
        if entry.command.type == "timeout":
            timeout(int(entry.player))
        elif entry.command.type == "limit":
            end_on_time_limit()
        else:
            apply(int(entry.player), entry.command)

func digest() -> String:
    return JSON.stringify({"state": state, "rng": random_state}).sha256_text()
