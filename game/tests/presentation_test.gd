extends SceneTree
var failures: int = 0
func check(value: bool, name: String) -> void:
    if not value:
        failures += 1
        printerr("PRODUCTION_TEST_FAIL: " + name)
func _initialize() -> void:
    call_deferred("run_test")
func run_test() -> void:
    var packed := load("res://src/main.tscn") as PackedScene
    var ui = packed.instantiate()
    root.add_child(ui)
    await process_frame
    ui.set_process(false)
    var settings_before: Dictionary = ui.audio.settings.duplicate()
    var test_path: String = "user://audio-test-" + str(Time.get_ticks_msec()) + ".cfg"
    ui.audio.settings_path = test_path
    check(ui.audio.set_volume("music", 0.0), "music mute accepted")
    check(ui.audio.set_volume("effects", 0.4), "effect category accepted")
    check(not ui.audio.set_volume("unknown", 0.5) and not ui.audio.set_volume("master", -1.0), "invalid settings rejected")
    check(ui.audio.music.volume_db <= -79.0, "zero music volume is effectively muted")
    ui.audio.flush()
    check(ui.audio.last_save_ok, "audio preferences saved")
    var reload_audio := AudioDirector.new()
    reload_audio.settings_path = test_path
    root.add_child(reload_audio)
    await process_frame
    check(reload_audio.settings.music == 0.0 and reload_audio.settings.effects == 0.4, "audio preferences restored")
    ui.show_audio_settings()
    check(ui.find_child("Volume_master", true, false) != null and ui.find_child("Volume_music", true, false) != null and ui.find_child("Volume_effects", true, false) != null, "three volume controls visible")
    ui.start_tutorial()
    ui.set_process(false)
    check(ui.tutorial and ui.game.state.active == 0 and ui.board_buttons.size() == 9, "safe tutorial fixture")
    var chosen: Dictionary = {}
    for action in ui.game.legal(0):
        if action.type == "play":
            chosen = action
            break
    check(not chosen.is_empty(), "tutorial has playable starting card")
    if not chosen.is_empty():
        ui.on_hand(int(chosen.hand))
        check(ui.tutorial_step == 1, "tutorial responds to card selection")
        ui.on_cell(int(chosen.cell))
        check(ui.game.count_cells(0) == 1 and ui.tutorial_step == 2, "tutorial places real unit")
    var count: int = ui.game.commands.size()
    ui.deadline = Time.get_unix_time_from_system() - 60
    ui.bot_due = Time.get_unix_time_from_system() + 60
    ui._process(0)
    check(ui.game.commands.size() == count, "tutorial reading time is not punished")
    ui.show_menu()
    check(not ui.tutorial and not ui.battle, "tutorial returns to menu")
    ui.start_match()
    ui.set_process(false)
    check(not ui.tutorial, "ordinary match retains normal timer mode")
    ui.show_menu()
    ui.audio.settings = settings_before
    ui.audio.debounce.stop()
    ui.queue_free()
    reload_audio.queue_free()
    await process_frame
    DirAccess.remove_absolute(test_path)
    if failures == 0:
        print("MULTIMENTAL_PRESENTATION_PASS tutorial=true volume_categories=3 preferences=true")
    quit(0 if failures == 0 else 1)
