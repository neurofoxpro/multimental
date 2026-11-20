extends SceneTree
const Matrix = preload("res://tests/support/balance_matrix_partition.gd")
func _initialize() -> void:
    var result: Dictionary = Matrix.run_part(3)
    if result.get("ok", false) and int(result.get("rows", 0)) == 20:
        print("MULTIMENTAL_BALANCE_MATRIX_PART_3_PASS rows=20")
        quit(0)
    else:
        printerr("PRODUCTION_TEST_FAIL: balance matrix part 3 " + str(result))
        quit(1)
