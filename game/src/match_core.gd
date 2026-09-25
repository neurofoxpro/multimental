class_name MatchCore
extends RefCounted
## Directional prototype v2. No scenes, clocks, UI or transport dependencies.
const ELEMENTS: Array[String] = ["fire", "water", "lightning", "air", "earth", "light", "dark", "mecha", "poison", "mystery"]
const ELEMENTS_RU: Array[String] = ["Огонь", "Вода", "Молния", "Воздух", "Земля", "Свет", "Тьма", "Меха", "Яд", "Тайна"]
const ELEMENTS_EN: Array[String] = ["Fire", "Water", "Lightning", "Air", "Earth", "Light", "Dark", "Mecha", "Poison", "Mystery"]
const NAMES_RU: Array[String] = ["Искра", "Пламя", "Капля", "Прилив", "Разряд", "Гроза", "Ветер", "Вихрь", "Камень", "Скала", "Луч", "Светоч", "Тень", "Мрак", "Дрон", "Титан", "Спора", "Токсин", "Шёпот", "Загадка"]
const NAMES_EN: Array[String] = ["Spark", "Flame", "Drop", "Tide", "Bolt", "Storm", "Breeze", "Gust", "Stone", "Rock", "Ray", "Beacon", "Shade", "Gloom", "Drone", "Titan", "Spore", "Toxin", "Whisper", "Enigma"]
const ELITES_RU: Array[String] = ["Ифрит", "Хранитель глубин", "Громовержец", "Небесный охотник", "Обсидиановый страж", "Архонт", "Владыка теней", "Осадный титан", "Чумной колосс", "Сфинкс"]
const ELITES_EN: Array[String] = ["Ifrit", "Deep Guardian", "Thunderlord", "Sky Hunter", "Obsidian Warden", "Archon", "Shadow Lord", "Siege Titan", "Plague Colossus", "Sphinx"]
const OUTER_ELEMENTS: Array[int] = [0, 1, 2, 3, 4, 8]
const CENTER_ELEMENTS: Array[int] = [5, 6, 7]
const CARD_COUNT: int = 30
const RULES_ID: String = "terrain-sweep-v3"
const TYPES: Array[String] = ["fighter", "guard", "lancer", "archer", "flanker"]
const TYPES_RU: Array[String] = ["Боец", "Страж", "Копейщик", "Стрелок", "Фланкер"]
const TYPES_EN: Array[String] = ["Fighter", "Guard", "Lancer", "Archer", "Flanker"]
const STARTER: Array[int] = [0, 1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 21, 23, 24]
var state: Dictionary = {}
var commands: Array[Dictionary] = []
var random_state: int = 1
var initial_seed: int = 1

func card(id: int) -> Dictionary:
    if id < 0 or id >= CARD_COUNT:
        return {}
    if id >= 20:
        var element: int = id - 20
        var elite_role: int = element % 5
        var elite_stats: Array = [[4, 4, 5], [5, 3, 8], [5, 4, 5], [6, 4, 4], [4, 3, 5]][elite_role]
        return {"id": id, "element": element, "ru": ELITES_RU[element], "en": ELITES_EN[element], "cost": elite_stats[0], "attack": elite_stats[1], "health": elite_stats[2], "role": elite_role, "kind": TYPES[elite_role]}
    var role: int = 0 if id % 2 == 0 else 1 + int(id / 2) % 4
    var stats: Array = [[1, 1, 2], [2, 1, 4], [2, 2, 2], [2, 1, 2], [2, 2, 3]][role]
    return {"id": id, "element": int(id / 2), "ru": NAMES_RU[id], "en": NAMES_EN[id], "cost": stats[0], "attack": stats[1], "health": stats[2], "role": role, "kind": TYPES[role]}

func next_random(maximum: int) -> int:
    random_state = (random_state * 48271) % 2147483647
    return random_state % maximum

func start(seed_value: int) -> void:
    initial_seed = maxi(1, seed_value % 2147483647)
    random_state = initial_seed
    commands.clear()
    var first: int = next_random(2)
    state = {"active": first, "first": first, "turn": 1, "winner": -1, "reason": "", "players": [], "board": [], "placed_cell": -1, "event_id": 0, "events": [], "terrain": [], "center_unlocked": false, "income_bonus": 0}
    for i in range(9):
        state.board.append(null)
    for player in range(2):
        var deck: Array[int] = STARTER.duplicate()
        for i in range(deck.size() - 1, 0, -1):
            var j: int = next_random(i + 1)
            var temp: int = deck[i]
            deck[i] = deck[j]
            deck[j] = temp
        var hand: Array[int] = []
        for i in range(4):
            hand.append(deck.pop_back())
        state.players.append({"deck": deck, "hand": hand, "coins": 1 if player == first else 2, "maximum": 1, "missed": 0, "started": 1 if player == first else 0})
    _draw(first)
    state.terrain = generate_terrain()

func generate_terrain() -> Array[int]:
    var bag: Array[int] = []
    for element in OUTER_ELEMENTS:
        bag.append(element)
        bag.append(element)
    var terrain: Array[int] = []
    for cell in range(9):
        if cell == 4:
            terrain.append(CENTER_ELEMENTS[next_random(CENTER_ELEMENTS.size())])
        else:
            var index: int = next_random(bag.size())
            terrain.append(bag[index])
            bag.remove_at(index)
    return terrain

func total_units() -> int:
    return count_cells(0) + count_cells(1)

func center_available() -> bool:
    return bool(state.center_unlocked) or total_units() >= 5 or int(state.turn) >= 7

func _observe_board(events: Array) -> void:
    var count: int = total_units()
    var bonus: int = 2 if count >= 6 else (1 if count >= 4 else 0)
    if bonus > int(state.income_bonus):
        state.income_bonus = bonus
        events.append({"type": "income_unlocked", "cell": 4, "amount": bonus})
    if not bool(state.center_unlocked) and center_available():
        state.center_unlocked = true
        events.append({"type": "center_unlocked", "cell": 4})

func attack_targets(source: int, unit: Dictionary, board: Array) -> Array[int]:
    var targets: Array[int] = []
    for cell in attack_cells(source, unit, board):
        if board[cell] != null:
            targets.append(cell)
    targets.sort()
    return targets

func count_cells(player: int) -> int:
    var count: int = 0
    for unit in state.board:
        if unit != null and int(unit.owner) == player:
            count += 1
    return count

func adjacent(a: int, b: int) -> bool:
    return absi(a % 3 - b % 3) + absi(int(a / 3) - int(b / 3)) == 1

static func rotated(offset: Vector2i, direction: int) -> Vector2i:
    for i in range(posmod(direction, 4)):
        offset = Vector2i(-offset.y, offset.x)
    return offset

func attack_cells(source: int, unit: Dictionary, board: Array) -> Array[int]:
    var result: Array[int] = []
    var definition: Dictionary = card(int(unit.get("id", -1)))
    if source < 0 or source >= 9 or board.size() != 9 or definition.is_empty():
        return result
    var kind: String = str(definition.kind)
    var rays: Array[Vector2i] = [Vector2i(0, -1)]
    if kind == "guard":
        rays = [Vector2i(0, -1), Vector2i(-1, 0), Vector2i(1, 0)]
    elif kind == "flanker":
        rays = [Vector2i(-1, -1), Vector2i(1, -1)]
    var reach: int = 2 if kind in ["lancer", "archer"] else 1
    for ray in rays:
        var forward: Vector2i = rotated(ray, int(unit.get("direction", 0)))
        for distance in range(1, reach + 1):
            var target: Vector2i = Vector2i(source % 3, int(source / 3)) + forward * distance
            if target.x < 0 or target.x > 2 or target.y < 0 or target.y > 2:
                break
            var cell: int = target.y * 3 + target.x
            result.append(cell)
            # Archer shoots over an intervening unit; spear stops at the first unit.
            if kind != "archer" and board[cell] != null:
                break
    return result

func attack_cost(source: int) -> int:
    return 0 if source == int(state.placed_cell) else 1

func legal(player: int) -> Array[Dictionary]:
    var result: Array[Dictionary] = []
    if int(state.winner) != -1 or int(state.active) != player:
        return result
    var p: Dictionary = state.players[player]
    if int(state.placed_cell) < 0:
        for hand_index in range(p.hand.size()):
            var definition: Dictionary = card(int(p.hand[hand_index]))
            if not definition.is_empty() and int(definition.cost) <= int(p.coins):
                for cell in range(9):
                    if state.board[cell] == null and (cell != 4 or center_available()):
                        # Compact command list: any validated quarter-turn is legal.
                        result.append({"type": "play", "hand": hand_index, "cell": cell, "direction": 0})
    for source in range(9):
        var unit: Variant = state.board[source]
        if unit == null or int(unit.owner) != player or int(p.coins) < attack_cost(source):
            continue
        for target in attack_cells(source, unit, state.board):
            if state.board[target] != null:
                result.append({"type": "attack", "source": source, "target": target})
    result.append({"type": "pass"})
    return result

static func integer(value: Variant, low: int, high: int) -> bool:
    if typeof(value) not in [TYPE_INT, TYPE_FLOAT]:
        return false
    var n: float = float(value)
    return is_finite(n) and n == floor(n) and n >= low and n <= high

static func normalize_command(value: Variant) -> Dictionary:
    if not value is Dictionary or not value.get("type") is String:
        return {"ok": false, "error": "invalid_command"}
    var fields: Array[String] = []
    match value.type:
        "play": fields = ["hand", "cell", "direction"]
        "attack": fields = ["source", "target"]
        "pass": fields = []
        _: return {"ok": false, "error": "invalid_command"}
    if value.size() != fields.size() + 1:
        return {"ok": false, "error": "unknown_command_field"}
    var command: Dictionary = {"type": value.type}
    for field in fields:
        var maximum: int = 99 if field == "hand" else (3 if field == "direction" else 8)
        if not integer(value.get(field), 0, maximum):
            return {"ok": false, "error": "invalid_command_number"}
        command[field] = int(value[field])
    return {"ok": true, "command": command}

func apply(player: int, value: Dictionary) -> Dictionary:
    if int(state.winner) != -1:
        return {"ok": false, "error": "finished"}
    if player != int(state.active):
        return {"ok": false, "error": "wrong_turn"}
    var parsed: Dictionary = normalize_command(value)
    if not parsed.ok:
        return parsed
    var command: Dictionary = parsed.command
    var comparison: Dictionary = command.duplicate(true)
    if comparison.type == "play":
        comparison.direction = 0
    if comparison not in legal(player):
        return {"ok": false, "error": "invalid_target"}
    var p: Dictionary = state.players[player]
    var events: Array[Dictionary] = []
    if command.type == "play":
        var id: int = int(p.hand[int(command.hand)])
        var definition: Dictionary = card(id)
        p.hand.remove_at(int(command.hand))
        p.coins = int(p.coins) - int(definition.cost)
        var cell: int = int(command.cell)
        var terrain_bonus: int = 1 if int(definition.element) == int(state.terrain[cell]) else 0
        state.board[cell] = {"id": id, "owner": player, "attack": int(definition.attack), "health": int(definition.health) + terrain_bonus, "max_health": int(definition.health) + terrain_bonus, "terrain_bonus": terrain_bonus, "direction": int(command.direction)}
        state.placed_cell = cell
        events.append({"type": "unit_placed", "cell": cell})
    elif command.type == "attack":
        var source: int = int(command.source)
        p.coins = int(p.coins) - attack_cost(source)
        _resolve_sweep(source, player, events)
    _observe_board(events)
    p.missed = 0
    commands.append({"player": player, "command": command.duplicate(true)})
    state.event_id = int(state.event_id) + 1
    state.events = events
    _check_victory()
    if command.type != "play" and int(state.winner) == -1:
        _finish_turn()
    return {"ok": true, "events": events}

func _resolve_sweep(source: int, player: int, events: Array) -> void:
    var a: Dictionary = state.board[source]
    var targets: Array[int] = attack_targets(source, a, state.board)
    var damage: int = int(a.attack)
    # Freeze the target set: outgoing strikes happen together, never pierce newly killed blockers.
    for target in targets:
        var defender: Dictionary = state.board[target]
        defender.health = int(defender.health) - damage
        events.append({"type": "damage", "cell": target, "amount": damage, "source": source, "wave": 0})
    for target in targets:
        if int(state.board[target].health) <= 0:
            state.board[target] = null
    # Only surviving enemies answer. Counters do not recursively trigger more attacks.
    var retaliation: int = 0
    for target in targets:
        var defender: Variant = state.board[target]
        if defender != null and int(defender.owner) != player and source in attack_cells(target, defender, state.board):
            retaliation += int(defender.attack)
            events.append({"type": "damage", "cell": source, "amount": int(defender.attack), "source": target, "wave": 1})
    a.health = int(a.health) - retaliation
    if int(a.health) <= 0:
        state.board[source] = null

func timeout(player: int) -> void:
    if state.winner != -1 or int(state.active) != player:
        return
    var p: Dictionary = state.players[player]
    commands.append({"player": player, "command": {"type": "timeout"}})
    # Expiring an optional attack after placing a card is not an AFK turn.
    p.missed = int(p.missed) + 1 if int(state.placed_cell) < 0 else 0
    state.event_id = int(state.event_id) + 1
    state.events = []
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

func _check_victory() -> void:
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

func _finish_turn() -> void:
    _check_victory()
    if state.winner != -1:
        return
    state.active = 1 - int(state.active)
    state.turn = int(state.turn) + 1
    state.placed_cell = -1
    _observe_board(state.events)
    var next: Dictionary = state.players[int(state.active)]
    next.maximum = mini(6, 1 + int((int(state.turn) - 1) / 2)) + int(state.income_bonus)
    # The second player receives +1 only for their opening turn, not every turn.
    next.coins = int(next.maximum) + (1 if int(next.started) == 0 else 0)
    next.started = int(next.started) + 1
    _draw(int(state.active))

func choose_ai() -> Dictionary:
    var player: int = int(state.active)
    var best: Dictionary = {"type": "pass"}
    var best_score: int = -100
    for command in legal(player):
        var score: int = -100
        var candidate: Dictionary = command.duplicate()
        if command.type == "play":
            var definition: Dictionary = card(int(state.players[player].hand[int(command.hand)]))
            score = 100 + int(definition.attack) * 4 + int(definition.health) * 2 + (8 if int(command.cell) == 4 else 0)
            if int(definition.element) == int(state.terrain[int(command.cell)]):
                score += 15
            if count_cells(player) == 4:
                score += 10000
            var facing_score: int = -10000
            for facing in range(4):
                var value: int = 0
                var dummy: Dictionary = {"id": int(state.players[player].hand[int(command.hand)]), "direction": facing}
                for target in attack_cells(int(command.cell), dummy, state.board):
                    var other: Variant = state.board[target]
                    value += 3 if other == null else (20 if int(other.owner) != player else -4)
                if value > facing_score:
                    facing_score = value
                    candidate.direction = facing
            score += facing_score
        elif command.type == "attack":
            var a: Dictionary = state.board[int(command.source)]
            score = 0
            var incoming: int = 0
            var primary_enemy: int = -1
            for target in attack_targets(int(command.source), a, state.board):
                var b: Dictionary = state.board[target]
                if int(b.owner) == player:
                    score -= 250
                    continue
                if primary_enemy < 0:
                    primary_enemy = target
                    candidate.target = target
                score += 35
                if int(b.health) <= int(a.attack):
                    score += 160
                    if count_cells(1 - player) >= 4:
                        score += 500
                elif int(command.source) in attack_cells(target, b, state.board):
                    incoming += int(b.attack)
            if incoming >= int(a.health):
                score -= 90
        if score > best_score:
            best_score = score
            best = candidate
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
