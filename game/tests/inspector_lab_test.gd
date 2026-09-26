extends SceneTree
const Lab = preload("res://src/inspector_device_lab.gd")
var failed: bool = false
var ui
var observed: Array[String] = []
var result: Dictionary = {}
func _initialize() -> void:
    call_deferred("run_test")
func run_test() -> void:
    root.gui_embed_subwindows = true
    root.content_scale_size = Vector2i(720, 1280)
    root.size = Vector2i(720, 1280)
    ui = load("res://src/main.tscn").instantiate()
    ui.profile.enabled = false
    ui.profile_directory = "user://profile-tests/inspector-wrapper-" + Crypto.new().generate_random_bytes(12).hex_encode()
    ui.profile_legacy_settings = ""
    root.add_child(ui)
    ui.set_process(false)
    var saved = ui.profile
    var lab = Lab.new()
    lab.ui = ui
    lab.nonce = Crypto.new().generate_random_bytes(24).hex_encode()
    lab.changed.connect(on_stage)
    lab.completed.connect(func(value: Dictionary): result = value)
    root.add_child(lab)
    var until: int = Time.get_ticks_msec() + 15000
    while result.is_empty() and Time.get_ticks_msec() < until:
        await create_timer(0.02).timeout
    var expected: Array = ["waiting_inspector_collection", "waiting_inspector_open", "waiting_inspector_close", "waiting_inspector_crafting", "waiting_inspector_craft_open", "waiting_inspector_craft_close"]
    failed = failed or observed != expected or result.get("status") != "passed" or ui.profile != saved
    failed = failed or not result.get("personal_profile_untouched", false) or ui.battle
    for item in result.get("checks", []):
        failed = failed or not item.ok
    lab.queue_free()
    ui.queue_free()
    await process_frame
    if failed:
        printerr("PRODUCTION_TEST_FAIL: inspector lab " + JSON.stringify(result))
    else:
        print("MULTIMENTAL_INSPECTOR_LAB_PASS simulated_signals=6 personal_profile_restored=true")
    quit(1 if failed else 0)
func on_stage(value: Dictionary) -> void:
    var stage: String = str(value.get("stage", ""))
    observed.append(stage)
    var target: BaseButton
    match stage:
        "waiting_inspector_collection": target = ui.find_child("OpenCollection", true, false)
        "waiting_inspector_open": target = ui.find_child("Details_c000", true, false)
        "waiting_inspector_close": target = ui.find_child("CollectionScreen", true, false).inspector.get_ok_button()
        "waiting_inspector_crafting": target = ui.find_child("OpenCrafting", true, false)
        "waiting_inspector_craft_open": target = ui.find_child("InspectCraftCard", true, false)
        "waiting_inspector_craft_close": target = ui.find_child("CraftingScreen", true, false).inspector.get_ok_button()
        _: failed = true
    if is_instance_valid(target) and not target.disabled:
        target.pressed.emit()
    else:
        failed = true
