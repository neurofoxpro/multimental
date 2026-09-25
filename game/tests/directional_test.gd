extends SceneTree
const Core = preload("res://src/match_core.gd")
const Rules = preload("res://src/net/room_rules.gd")
const View = preload("res://src/net/room_view.gd")
var failures: int = 0
var checks: int = 0
func check(value: bool, description: String) -> void:
    checks += 1
    if not value:
        failures += 1
        printerr("PRODUCTION_TEST_FAIL: " + description)
func unit(id: int, player: int, direction: int, health: int = 8) -> Dictionary:
    var definition: Dictionary = Core.new().card(id)
    return {"id": id, "owner": player, "direction": direction, "attack": definition.attack, "health": health}
func fixture():
    var g = Core.new()
    g.start(42)
    g.state.players[0].hand = [0, 1, 3, 5, 7]
    g.state.players[0].coins = 6
    return g
func _initialize() -> void:
    var g = fixture()
    check(Core.ELEMENTS.size() == 10 and Core.CARD_COUNT == 20, "ten elements / twenty units")
    check(Core.ELEMENTS.slice(5) == ["light", "dark", "mecha", "poison", "mystery"], "requested element names")
    var roles: Dictionary = {}
    for id in range(Core.CARD_COUNT):
        var c: Dictionary = g.card(id)
        check(int(c.element) == int(id / 2) and not str(c.ru).is_empty() and not str(c.en).is_empty(), "catalogue identity/localization")
        roles[c.kind] = true
    check(roles.size() == 5, "five independent archetypes")
    var starter_roles: Dictionary = {}
    var starter_elements: Dictionary = {}
    for id in Core.STARTER:
        var c: Dictionary = g.card(id)
        starter_roles[c.kind] = true
        starter_elements[c.element] = true
    check(starter_roles.size() == 5 and starter_elements.size() == 10, "all elements and archetypes actually playable in starter deck")
    check(g.card(-1).is_empty() and g.card(20).is_empty(), "reject unknown card IDs")
    for id in range(0, 20, 2):
        check(g.card(id).attack == g.card(0).attack and g.card(id).health == g.card(0).health, "element label grants no stat advantage")
    for facing in range(4):
        var expected: Array = [[1], [5], [7], [3]][facing]
        check(g.attack_cells(4, unit(0, 0, facing), g.state.board) == expected, "quarter-turn firing arc")
    check(g.attack_cells(0, unit(0, 0, 0), g.state.board).is_empty(), "off-board direction does not wrap")
    check(g.attack_cells(4, unit(1, 0, 0), g.state.board) == [1, 3, 5], "guard front/flanks")
    check(g.attack_cells(7, unit(3, 0, 0), g.state.board) == [4, 1], "lancer range")
    g.state.board[4] = unit(0, 0, 0)
    check(g.attack_cells(7, unit(3, 0, 0), g.state.board) == [4], "lancer line blocked by any unit")
    check(g.attack_cells(7, unit(5, 0, 0), g.state.board) == [4, 1], "archer fires over intervening unit")
    check(g.attack_cells(4, unit(7, 0, 0), g.state.board) == [0, 2], "flanker diagonals")
    g = fixture()
    g.state.board[1] = unit(0, 1, 0)
    var before_turn: int = g.state.turn
    var before_hand: int = g.state.players[0].hand.size()
    check(g.apply(0, {"type": "play", "hand": 0, "cell": 4, "direction": 0}).ok, "summon accepted")
    check(g.state.active == 0 and g.state.turn == before_turn and g.state.placed_cell == 4, "summon retains optional attack")
    check(g.state.board[1].health == 8, "no automatic attack")
    check(g.state.players[0].hand.size() == before_hand - 1, "no extra draw on summon")
    var after_play: String = g.digest()
    check(not g.apply(0, {"type": "play", "hand": 0, "cell": 5, "direction": 0}).ok and after_play == g.digest(), "cannot place twice")
    var coins: int = g.state.players[0].coins
    check(g.apply(0, {"type": "attack", "source": 4, "target": 1}).ok, "fresh unit attacks same turn")
    check(g.state.players[0].coins == coins and g.state.board[1].health == 7, "fresh attack free and effective")
    check(g.state.active == 1 and g.state.turn == before_turn + 1, "one attack ends turn")
    check(not g.apply(0, {"type": "attack", "source": 4, "target": 1}).ok, "second attack refused")
    g = fixture()
    g.state.board[3] = unit(0, 0, 1)
    g.state.board[4] = unit(0, 1, 0)
    g.apply(0, {"type": "play", "hand": 0, "cell": 8, "direction": 0})
    coins = g.state.players[0].coins
    check(g.apply(0, {"type": "attack", "source": 3, "target": 4}).ok, "old unit may replace new attacker")
    check(g.state.players[0].coins == coins - 1, "old unit costs exactly one coin")
    check(not g.apply(0, {"type": "attack", "source": 8, "target": 4}).ok, "cannot also attack with fresh unit")
    g = fixture()
    g.state.board[3] = unit(0, 0, 1)
    g.state.board[4] = unit(0, 0, 3)
    coins = g.state.players[0].coins
    check(g.apply(0, {"type": "attack", "source": 3, "target": 4}).ok, "friendly fire accepted")
    check(g.state.board[4].health == 7 and g.state.board[3].health == 8 and g.state.players[0].coins == coins - 1, "ally damage with no automatic allied retaliation")
    g = fixture()
    g.state.board[3] = unit(0, 0, 1)
    g.state.board[4] = unit(0, 1, 3)
    g.state.players[0].coins = 0
    var original: String = g.digest()
    check(not g.apply(0, {"type": "attack", "source": 3, "target": 4}).ok and g.digest() == original, "no coin cannot activate old unit")
    g.state.players[0].coins = 1
    check(g.apply(0, {"type": "attack", "source": 3, "target": 4}).ok, "attack without summoning allowed")
    check(g.state.board[3].health == 7 and g.state.board[4].health == 7, "facing enemy counterattacks simultaneously")
    check(g.state.events.size() == 2 and g.state.events[0].amount == 1, "explicit damage events")
    g = fixture()
    g.state.board[3] = unit(0, 0, 0)
    g.state.board[4] = unit(0, 1, 0)
    original = g.digest()
    check(not g.apply(0, {"type": "attack", "source": 3, "target": 4}).ok and g.digest() == original, "attack outside firing arc rejected")
    for facing in [-1, 4, 0.5, true, "1"]:
        check(not g.apply(0, {"type": "play", "hand": 0, "cell": 0, "direction": facing}).ok and g.digest() == original, "invalid facing no mutation")
    check(not g.apply(0, {"type": "play", "hand": 0, "cell": 0}).ok, "direction required by new rules")
    check(not g.apply(0, {"type": "rotate", "source": 3, "direction": 1}).ok, "no rotating a deployed card")
    g = fixture()
    g.apply(0, {"type": "play", "hand": 0, "cell": 4, "direction": 3})
    check(g.apply(0, {"type": "pass"}).ok and g.state.active == 1, "optional attack can be declined")
    g = fixture()
    g.apply(0, {"type": "play", "hand": 0, "cell": 4, "direction": 0})
    g.timeout(0)
    check(g.state.players[0].missed == 0 and g.state.active == 1, "optional attack timeout is not an entirely missed turn")
    for seed_value in range(1, 101):
        g.start(seed_value)
        var first: int = g.state.first
        var second: int = 1 - first
        check(g.state.players[first].coins == 1 and g.state.players[second].coins == 2, "second player +1 from match start")
        g.apply(first, {"type": "pass"})
        check(g.state.players[second].coins == 2, "opening bonus survives first handover")
        g.apply(second, {"type": "pass"})
        g.apply(first, {"type": "pass"})
        check(g.state.players[second].coins == 2, "bonus does not recur next round")
    var room = Rules.new()
    var secret: String = "a".repeat(64)
    room.configure(42, secret, 1000)
    room.connect_guest(secret, "b".repeat(64), 1000)
    var move: Dictionary = room.game.legal(0)[0].duplicate()
    move.direction = 1
    var end_time: int = room.turn_deadline
    var receipt: Dictionary = room.act(0, 1, JSON.parse_string(JSON.stringify(move)), 2000)
    check(receipt.ok and room.turn_deadline == end_time, "summon does not renew network turn timer")
    original = room.game.digest()
    check(room.act(0, 1, move, 2000) == receipt and original == room.game.digest(), "oriented command replay idempotent")
    move.direction = 2
    check(room.act(0, 1, move, 2000).get("error") == "duplicate_conflict", "changed rotation is not same command")
    for player in [0, 1]:
        var view: Dictionary = room.view_for(player)
        check(View.valid(view), "new player projection valid")
        check(not view.has("seed") and not view.has("players") and not view.has("deck"), "secret state stays private")
        var stale: Dictionary = view.duplicate(true)
        stale.rules = "prototype-v1"
        check(not View.valid(stale), "previous rules rejected")
        stale = view.duplicate(true)
        stale.board[int(stale.placed_cell)].direction = 5
        check(not View.valid(stale), "invalid unit facing rejected on wire")
    for seed_value in range(1, 201):
        g.start(seed_value)
        for step in range(180):
            if g.state.winner != -1:
                break
            var actor: int = g.state.active
            var chosen: Dictionary = g.choose_ai()
            if chosen.type == "attack":
                check(g.state.board[int(chosen.target)].owner != actor, "AI does not waste allies")
            check(g.apply(actor, chosen).ok, "directional AI action legal")
            check(g.count_cells(0) + g.count_cells(1) <= 9, "nine-cell invariant")
            for p in g.state.players:
                check(int(p.coins) >= 0, "coins never negative")
        if g.state.winner == -1:
            g.end_on_time_limit()
        var copy = Core.new()
        copy.replay(seed_value, g.commands.duplicate(true))
        check(copy.digest() == g.digest(), "oriented multi-command deterministic replay")
    if failures == 0:
        print("MULTIMENTAL_DIRECTIONAL_PASS checks=%d simulations=200" % checks)
    quit(0 if failures == 0 else 1)
