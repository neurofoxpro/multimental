extends SceneTree

func _init() -> void:
    print("[smoke] Starting Multimental headless check")

    var project_name := str(ProjectSettings.get_setting("application/config/name", ""))
    if project_name != "Multimental":
        push_error("[smoke] Unexpected project name: %s" % project_name)
        quit(1)
        return

    var scene := load("res://src/main.tscn") as PackedScene
    if scene == null:
        push_error("[smoke] Unable to load main scene")
        quit(1)
        return

    var instance := scene.instantiate()
    if instance == null:
        push_error("[smoke] Unable to instantiate main scene")
        quit(1)
        return

    instance.free()
    print("[smoke] Main scene loaded successfully")
    print("[smoke] PASS")
    quit(0)
