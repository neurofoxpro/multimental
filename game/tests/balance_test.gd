extends SceneTree
const Core = preload("res://src/match_core.gd")
func _initialize() -> void:
    var g = Core.new()
    var checks: int = 0
    var expected: Array = [[1, 1, 2], [2, 1, 4], [2, 2, 3], [2, 2, 2], [2, 2, 2]]
    for id in range(Core.CARD_COUNT):
        var c: Dictionary = g.card(id)
        if int(c.cost) < 1 or int(c.attack) < 1 or int(c.health) < 1:
            printerr("PRODUCTION_TEST_FAIL: positive unit parameters")
            quit(1)
            return
        if id < 20 and [int(c.cost), int(c.attack), int(c.health)] != expected[int(c.role)]:
            printerr("PRODUCTION_TEST_FAIL: validated archetype parameters")
            quit(1)
            return
        checks += 1
        if id in [5, 13] and (int(c.attack) != 2 or int(c.cost) != 2 or int(c.health) != 2):
            printerr("PRODUCTION_TEST_FAIL: validated archer parameters")
            quit(1)
            return
        if id >= 20 and (int(c.cost) < 4 or int(c.cost) > 6):
            printerr("PRODUCTION_TEST_FAIL: elite costs remain reviewed")
            quit(1)
            return
    print("MULTIMENTAL_BALANCE_PARAMETERS_PASS checks=%d" % checks)
    quit(0)
