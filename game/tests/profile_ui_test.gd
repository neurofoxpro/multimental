extends SceneTree
const Store = preload("res://src/profile_store.gd")
const Controller = preload("res://src/profile_controller.gd")
var failures: int = 0
var checks: int = 0
class LostAckStore extends Store:
    var fail_once: bool = true
    func _write_slot(filename: String, text: String) -> Error:
        var result: Error = super._write_slot(filename, text)
        if fail_once and result == OK:
            fail_once = false
            return ERR_FILE_CANT_WRITE
        return result
func check(value: bool, name: String) -> void:
    checks += 1
    if not value:
        failures += 1
        print("PROFILE_UI_FAIL " + name)
func _initialize() -> void:
    call_deferred("run_test")
func make_ui(directory: String):
    var ui = load("res://src/main.tscn").instantiate()
    ui.profile_directory = directory
    ui.profile_legacy_settings = ""
    root.add_child(ui)
    ui.set_process(false)
    return ui
func run_test() -> void:
    var directory: String = "user://profile-tests/" + Crypto.new().generate_random_bytes(12).hex_encode()
    var ui = make_ui(directory)
    await process_frame
    check(ui.profile.storage.writable and ui.profile.state().stats.matches == 0, "UI opens persistent profile")
    check(ui.find_child("ProfileSummary", true, false) != null, "profile summary visible")
    ui.toggle_language()
    check(ui.language == "en", "language command")
    ui.start_match()
    ui.game.start(42)
    for index in range(600):
        if ui.game.state.winner != -1:
            break
        ui.game.apply(int(ui.game.state.active), ui.game.choose_ai())
    check(ui.game.state.winner != -1, "real seeded game finishes")
    ui.after_action()
    check(ui.result_saved and ui.profile.state().stats.matches == 1, "finished game commits once")
    var recorded: Dictionary = ui.profile.state().lastMatch.replay
    check(JSON.stringify(recorded.commands) == JSON.stringify(JSON.parse_string(JSON.stringify(ui.game.commands))), "serialized replay and statistics committed together")
    var commands: Array[Dictionary] = []
    commands.assign(recorded.commands)
    var replayed = preload("res://src/match_core.gd").new()
    replayed.replay(int(recorded.seed), commands)
    check(replayed.digest() == ui.game.digest(), "stored JSON reconstructs exact final match state")
    for index in range(10):
        ui._save_finished_match()
    ui.result_saved = false
    ui._save_finished_match()
    check(ui.profile.state().stats.matches == 1, "repeated UI callback cannot double count")
    ui.show_menu()
    ui.queue_free()
    await process_frame
    ui = make_ui(directory)
    check(ui.language == "en" and ui.profile.state().stats.matches == 1, "UI restart restores language and game result")
    ui.start_tutorial()
    ui.game.state.winner = 0
    ui._save_finished_match()
    check(ui.profile.state().stats.matches == 1, "tutorial does not farm statistics")
    ui.show_menu()
    ui.profile.storage = LostAckStore.new(directory)
    check(ui.profile.open_profile(), "controller reopens same profile")
    ui.start_match()
    ui.game.start(42)
    ui.game.state.winner = 0
    ui.game.state.reason = "test-fixture"
    ui._save_finished_match()
    check(not ui.result_saved and not ui.profile.pending.is_empty(), "write acknowledgement loss is not success")
    ui.toggle_language()
    check(ui.profile.pending.is_empty() and ui.profile.state().stats.matches == 2, "pending match reconciled before language write")
    ui._save_finished_match()
    check(ui.profile.state().stats.matches == 2, "reconciled match not counted again by menu")
    ui.show_menu()
    ui.online = true
    ui.result_saved = false
    ui.local_match_id = "test-local-network-result"
    ui._save_network_result({"winner": 0, "reason": "five", "hand": [1, 2], "seed": 123})
    check(ui.profile.state().stats.matches == 3, "network outcome saved to local statistics")
    check(ui.profile.state().lastMatch.replay.scope == "public_result_only" and not ui.profile.state().lastMatch.replay.has("seed") and not ui.profile.state().lastMatch.replay.has("hand"), "network result excludes private hands and seed")
    ui.result_saved = false
    ui._save_network_result({"winner": 0, "reason": "five"})
    check(ui.profile.state().stats.matches == 3, "repeated network result cannot double count")
    ui.show_menu()
    var a_before: String = FileAccess.get_sha256(directory.path_join("a.json"))
    var b_before: String = FileAccess.get_sha256(directory.path_join("b.json"))
    ui.profile.enabled = false
    ui.toggle_language()
    ui.start_match()
    ui.game.state.winner = 0
    ui._save_finished_match()
    check(FileAccess.get_sha256(directory.path_join("a.json")) == a_before and FileAccess.get_sha256(directory.path_join("b.json")) == b_before, "diagnostic mode never writes personal profile")
    ui.queue_free()
    await process_frame
    for name in ["a.json", "b.json"]:
        var file := FileAccess.open(directory.path_join(name), FileAccess.WRITE)
        file.store_string("damaged-" + name)
        file.close()
    ui = make_ui(directory)
    check(not ui.profile.storage.writable and not ui.profile.error.is_empty(), "corruption remains visible")
    check(FileAccess.get_file_as_string(directory.path_join("a.json")) == "damaged-a.json", "UI does not reset corrupt save")
    ui.queue_free()
    await process_frame
    if failures == 0:
        for name in ["a.json", "b.json"]:
            DirAccess.remove_absolute(directory.path_join(name))
        DirAccess.remove_absolute(directory)
        print("MULTIMENTAL_PROFILE_UI_PASS checks=" + str(checks))
    quit(0 if failures == 0 else 1)
