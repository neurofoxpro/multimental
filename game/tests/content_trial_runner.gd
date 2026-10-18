extends SceneTree
const Simulation=preload("res://tests/support/content_simulation.gd")
func _initialize()->void:
    var args:PackedStringArray=OS.get_cmdline_user_args()
    if args.size()!=2:
        printerr("CONTENT_TRIAL_FAIL exact input and output required")
        quit(1)
        return
    var parsed=JSON.new()
    if parsed.parse(FileAccess.get_file_as_string(args[0]))!=OK or not parsed.data is Dictionary:
        printerr("CONTENT_TRIAL_FAIL normalized input unavailable")
        quit(1)
        return
    var result:Dictionary=Simulation.run_trial(parsed.data)
    if not result.get("ok",false):
        printerr("CONTENT_TRIAL_FAIL "+str(result))
        quit(1)
        return
    result.engine=Engine.get_version_info().string
    result.engineVersion=Engine.get_version_info()
    var out:=FileAccess.open(args[1],FileAccess.WRITE)
    if out==null:
        printerr("CONTENT_TRIAL_FAIL output unavailable")
        quit(1)
        return
    out.store_string(JSON.stringify(result))
    out.close()
    print("MULTIMENTAL_CONTENT_TRIAL_PASS games="+str(result.rows.size())+" replays="+str(result.replaysVerified))
    quit(0)
