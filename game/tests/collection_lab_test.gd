extends SceneTree
const Lab = preload("res://src/collection_device_lab.gd")
var failed: bool = false
var ui
var observed: Array[String] = []
var result: Dictionary = {}
func _initialize() -> void:
    call_deferred("run_test")
func run_test() -> void:
    root.size = Vector2i(720, 1280)
    ui = load("res://src/main.tscn").instantiate()
    ui.profile.enabled = false
    ui.profile_directory = "user://profile-tests/lab-wrapper-" + Crypto.new().generate_random_bytes(12).hex_encode()
    ui.profile_legacy_settings = ""
    root.add_child(ui)
    ui.set_process(false)
    var saved_controller = ui.profile
    var lab = Lab.new()
    lab.ui = ui
    lab.nonce = Crypto.new().generate_random_bytes(24).hex_encode()
    lab.changed.connect(on_stage)
    lab.completed.connect(func(value: Dictionary): result = value)
    root.add_child(lab)
    var until: int = Time.get_ticks_msec() + 12000
    while result.is_empty() and Time.get_ticks_msec() < until:
        await create_timer(0.02).timeout
    var expected: Array = ["waiting_collection_new", "waiting_collection_add", "waiting_collection_remove", "waiting_collection_add_again", "waiting_collection_complete", "waiting_collection_save", "waiting_collection_select", "waiting_collection_play"]
    failed = failed or observed != expected or result.get("status") != "passed" or ui.profile != saved_controller
    failed = failed or not result.get("personal_profile_untouched", false) or ui.battle
    lab.queue_free()
    ui.queue_free()
    await process_frame
    if failed:
        printerr("PRODUCTION_TEST_FAIL: collection lab " + JSON.stringify(result))
    else:
        print("MULTIMENTAL_COLLECTION_LAB_PASS simulated_signals=8 personal_profile_restored=true")
    quit(1 if failed else 0)
func on_stage(value: Dictionary) -> void:
    var stage: String = str(value.get("stage", ""))
    observed.append(stage)
    var editor = ui.find_child("CollectionScreen", true, false)
    var target: BaseButton
    match stage:
        "waiting_collection_new": target = editor.new_button
        "waiting_collection_add", "waiting_collection_add_again", "waiting_collection_complete": target = editor.find_child("Add_c000", true, false)
        "waiting_collection_remove": target = editor.find_child("Remove_c000", true, false)
        "waiting_collection_save": target = editor.save_button
        "waiting_collection_select": target = editor.choose_button
        "waiting_collection_play": target = editor.play_button
        _: failed = true
    if is_instance_valid(target) and not target.disabled:
        target.pressed.emit()
    else:
        failed = true
