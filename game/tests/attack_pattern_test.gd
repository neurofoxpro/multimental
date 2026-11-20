extends SceneTree
const Core = preload("res://src/match_core.gd")
const Patterns = preload("res://src/attack_pattern.gd")
var checks: int = 0
var errors: int = 0
func check(ok: bool, label: String) -> void:
    checks += 1
    if not ok:
        errors += 1
        printerr("ATTACK_PATTERN_FAIL " + label)

class PatternCore:
    extends "res://src/match_core.gd"
    var attack_pattern: String = ""
    func card(id: int) -> Dictionary:
        var d: Dictionary = super.card(id)
        if id == 0 and not d.is_empty():
            d["pattern"] = attack_pattern
        return d

func _initialize() -> void:
    var expected: Dictionary = {
        "up_right": [Vector2i(0,-1),Vector2i(1,0)],
        "up_left": [Vector2i(0,-1),Vector2i(-1,0)],
        "left_right": [Vector2i(-1,0),Vector2i(1,0)],
        "up_down": [Vector2i(0,-1),Vector2i(0,1)]
    }
    for kind in expected:
        check(Patterns.rays("fighter",kind) == expected[kind], "source rays " + kind)
        for facing in range(4):
            var seen: Dictionary = {}
            for ray in Patterns.rays("fighter",kind):
                var rotated: Vector2i = Core.rotated(ray,facing)
                seen[rotated] = true
            check(seen.size() == 2, "unique rotated rays " + kind + " " + str(facing))
    check(Patterns.rays("fighter","free_target").size() == 8, "free target includes 8 neighbors")
    check(Patterns.rays("guard","") == [Vector2i(0,-1),Vector2i(-1,0),Vector2i(1,0)], "legacy guard preserved")
    check(Patterns.rays("flanker","") == [Vector2i(-1,-1),Vector2i(1,-1)], "legacy flanker preserved")
    var g := PatternCore.new()
    g.start(42)
    g.attack_pattern = "up_right"
    g.state.board.fill(null)
    g.state.board[4] = {"id":0, "owner":0, "attack":1, "health":2, "direction":0}
    check(g.attack_cells(4,g.state.board[4],g.state.board) == [1,5], "center up and right cells")
    g.state.board[4].direction = 1
    check(g.attack_cells(4,g.state.board[4],g.state.board) == [5,7], "rotate clockwise moves both rays")
    g.attack_pattern = "free_target"
    var cells: Array[int] = g.attack_cells(4,g.state.board[4],g.state.board)
    cells.sort()
    check(cells == [0,1,2,3,5,6,7,8], "free aim reaches all other board cells from center")
    check(g.attack_cells(0,g.state.board[4],g.state.board).size() == 8, "free aim reaches all other cells even from a corner")
    g.state.board[1] = {"id":2,"owner":1,"attack":1,"health":5,"direction":0}
    g.state.board[5] = {"id":2,"owner":1,"attack":1,"health":5,"direction":0}
    var events: Array = []
    g._resolve_sweep(4,0,events,1)
    check(int(g.state.board[1].health) == 4 and int(g.state.board[5].health) == 5, "free targeting damages only chosen neighbor")
    print("MULTIMENTAL_ATTACK_PATTERN_RESULT checks=%d failures=%d" % [checks,errors])
    if errors == 0:
        print("MULTIMENTAL_ATTACK_PATTERN_PASS")
    quit(0 if errors == 0 else 1)
