extends SceneTree
const Core = preload("res://src/match_core.gd")
const Rules = preload("res://src/net/room_rules.gd")
const View = preload("res://src/net/room_view.gd")
var checks: int = 0
var failures: int = 0
func check(ok: bool, title: String) -> void:
    checks += 1
    if not ok:
        failures += 1
        printerr("PRODUCTION_TEST_FAIL: " + title)
func fixture():
    var g = Core.new()
    g.start(42)
    g.state.players[0].hand = [0, 1, 3, 5, 7, 20]
    g.state.players[0].coins = 6
    return g
func unit(id: int, owner: int, direction: int, health: int = 8, attack: int = 2) -> Dictionary:
    return {"id": id, "owner": owner, "direction": direction, "health": health, "attack": attack}
func _initialize() -> void:
    var layouts: Dictionary = {}
    for seed_value in range(1, 501):
        var g = Core.new()
        g.start(seed_value)
        var counts: Dictionary = {}
        check(g.state.terrain.size() == 9, "nine terrain cells")
        for cell in range(9):
            var element: int = int(g.state.terrain[cell])
            check(element in (Core.CENTER_ELEMENTS if cell == 4 else Core.OUTER_ELEMENTS), "terrain domain")
            counts[element] = int(counts.get(element, 0)) + 1
            check(int(counts[element]) <= 2, "no element has more than two cells")
            check(element != 9, "mystery has no terrain")
        layouts[JSON.stringify(g.state.terrain)] = true
        var copy = Core.new()
        copy.start(seed_value)
        check(g.digest() == copy.digest(), "seed includes terrain deterministically")
    check(layouts.size() > 200, "varied random boards")
    var g = fixture()
    check(not g.center_available(), "center initially locked")
    var original: String = g.digest()
    check(not g.apply(0, {"type": "play", "hand": 0, "cell": 4, "direction": 0}).ok and g.digest() == original, "locked placement cannot spend or mutate")
    for i in range(6):
        g.apply(int(g.state.active), {"type": "pass"})
    check(g.state.turn == 7 and g.state.center_unlocked and g.center_available(), "turn seven unlocks empty center")
    check(g.apply(0, {"type": "play", "hand": 0, "cell": 4, "direction": 0}).ok, "center can now be occupied")
    g = fixture()
    for i in range(4):
        g.state.board[i] = unit(0, i % 2, 0)
    check(not g.center_available(), "four units do not unlock center")
    check(g.apply(0, {"type": "play", "hand": 0, "cell": 5, "direction": 0}).ok, "fifth total unit placed")
    check(g.state.center_unlocked, "fifth unit unlocks center immediately")
    g.state.board[5] = null
    g.apply(0, {"type": "pass"})
    check(g.center_available(), "center remains open after casualties")
    g = fixture()
    g.state.terrain[0] = 0
    g.apply(0, {"type": "play", "hand": 0, "cell": 0, "direction": 1})
    check(g.state.board[0].health == 3 and g.state.board[0].max_health == 3 and g.state.board[0].terrain_bonus == 1, "matching terrain grants one HP")
    if failures == 0:
        print("MULTIMENTAL_TERRAIN_PASS checks=%d layouts=500" % checks)
    quit(0 if failures == 0 else 1)
