extends SceneTree
const Audit=preload("res://tests/support/balance_audit.gd")
func _initialize()->void:
    var args:PackedStringArray=OS.get_cmdline_user_args()
    if args.size()!=2:
        printerr("BALANCE_AUDIT_FAIL exact input/output required")
        quit(1)
        return
    var parsed=JSON.new()
    if parsed.parse(FileAccess.get_file_as_string(args[0]))!=OK or not parsed.data is Dictionary:
        printerr("BALANCE_AUDIT_FAIL input unavailable")
        quit(1)
        return
    var result:Dictionary=Audit.shard(parsed.data)
    if not result.get("ok",false):
        printerr("BALANCE_AUDIT_FAIL "+str(result))
        quit(1)
        return
    var out:=FileAccess.open(args[1],FileAccess.WRITE)
    if out==null:
        printerr("BALANCE_AUDIT_FAIL output unavailable")
        quit(1)
        return
    out.store_string(JSON.stringify(result))
    out.close()
    print("MULTIMENTAL_BALANCE_AUDIT_PASS games="+str(result.rows.size()))
    quit(0)
