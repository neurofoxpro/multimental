extends SceneTree
const Lab = preload("res://src/rewards_device_lab.gd")
var failed: bool = false
var ui
var observed: Array[String] = []
var result: Dictionary = {}
func _initialize() -> void:
    call_deferred("run_test")
func run_test() -> void:
    root.content_scale_size = Vector2i(720, 1280)
    root.size = Vector2i(720, 1280)
    ui = load("res://src/main.tscn").instantiate()
    ui.profile.enabled = false
    ui.profile_directory = "user://profile-tests/rewards-wrapper-" + Crypto.new().generate_random_bytes(12).hex_encode()
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
    var expected: Array = ["waiting_rewards_open", "waiting_rewards_one", "waiting_rewards_three", "waiting_rewards_back", "waiting_rewards_reopen"]
    failed = failed or observed != expected or result.get("status") != "passed" or ui.profile != saved or not result.get("personal_profile_untouched", false)
    failed = failed or result.get("test") != "real_rewards_quests" or result.get("checks", []).size() != 9
    for item in result.get("checks", []):
        failed = failed or not item.ok
    lab.queue_free()
    ui.queue_free()
    await process_frame
    if failed:
        printerr("PRODUCTION_TEST_FAIL: rewards lab " + JSON.stringify(result))
    else:
        print("MULTIMENTAL_REWARDS_LAB_PASS simulated_signals=5 fixture_matches_by_api=3 personal_profile_restored=true")
    quit(1 if failed else 0)
func on_stage(value: Dictionary) -> void:
    var stage: String = str(value.get("stage", ""))
    observed.append(stage)
    var control: BaseButton
    match stage:
        "waiting_rewards_open", "waiting_rewards_reopen": control = ui.find_child("OpenRewards", true, false)
        "waiting_rewards_one": control = ui.find_child("Claim_play_one", true, false)
        "waiting_rewards_three": control = ui.find_child("Claim_play_three", true, false)
        "waiting_rewards_back": control = ui.find_child("RewardsBack", true, false)
        _: failed = true
    if is_instance_valid(control) and not control.disabled:
        control.pressed.emit()
    else:
        failed = true
