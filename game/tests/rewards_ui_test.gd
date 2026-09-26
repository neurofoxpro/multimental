extends SceneTree
const Store = preload("res://src/profile_store.gd")
const Policy = preload("res://src/rewards_policy.gd")
var checks: int = 0
var failures: int = 0
class LostAckStore extends Store:
    var lose: bool = false
    func _write_slot(filename: String, text: String) -> Error:
        var result: Error = super._write_slot(filename, text)
        if lose and result == OK:
            lose = false
            return ERR_FILE_CANT_WRITE
        return result
func check(value: bool, text: String) -> void:
    checks += 1
    if not value:
        failures += 1
        print("REWARDS_UI_FAIL " + text)
func _initialize() -> void:
    call_deferred("run_test")
func run_test() -> void:
    var directory: String = "user://profile-tests/rewards-ui-" + Crypto.new().generate_random_bytes(10).hex_encode()
    var ui = load("res://src/main.tscn").instantiate()
    ui.profile_directory = directory
    ui.profile_legacy_settings = ""
    root.add_child(ui)
    ui.set_process(false)
    await process_frame
    check(ui.find_child("OpenRewards", true, false) != null and not ui.profile.state().has("rewards"), "menu reads without initializing rewards")
    ui.show_rewards()
    await process_frame
    var screen = ui.find_child("RewardsScreen", true, false)
    check(screen != null and screen.buttons.play_one.disabled and screen.buttons.play_three.disabled, "new day has no free quest reward")
    check(ui.profile.state().wallet.gold == 0 and not ui.profile.state().has("collection"), "reward entry never creates shop or collection grant")
    screen.claim("play_one")
    check(ui.profile.pending.is_empty() and ui.profile.state().wallet.gold == 0, "premature direct callback never poisons pending stream")
    screen.leave()
    for round_index in range(3):
        ui.start_match()
        ui.game.start(42 + round_index)
        for action in range(600):
            if ui.game.state.winner != -1:
                break
            ui.game.apply(int(ui.game.state.active), ui.game.choose_ai())
        check(ui.game.state.winner != -1, "real deterministic battle completes")
        var before_gold: int = int(ui.profile.state().wallet.gold)
        ui.after_action()
        var outcome: String = "win" if ui.game.state.winner == 0 else ("draw" if ui.game.state.winner == 2 else "loss")
        check(ui.result_saved and int(ui.profile.state().wallet.gold) == before_gold + int(Policy.match_reward(outcome).gold), "normal match pays exact outcome reward")
        ui.result_saved = false
        ui._save_finished_match()
        check(int(ui.profile.state().stats.matches) == round_index + 1, "replayed finished callback not another reward")
        ui.show_menu()
    var before: Dictionary = ui.profile.state()
    check(before.rewards.played == 3 and before.inventory.size() == 30, "quests share saved match progression and collection retained")
    ui.show_rewards()
    screen = ui.find_child("RewardsScreen", true, false)
    check(not screen.buttons.play_one.disabled and not screen.buttons.play_three.disabled, "both voluntary rewards are claimable")
    screen.buttons.play_one.pressed.emit()
    check(ui.profile.state().wallet.gold == int(before.wallet.gold) + 25 and screen.buttons.play_one.disabled, "first claim saved and disabled")
    screen.claim("play_one")
    check(ui.profile.pending.is_empty() and ui.profile.state().wallet.gold == int(before.wallet.gold) + 25, "second direct callback is harmless")
    var faulty = LostAckStore.new(directory)
    ui.profile.storage = faulty
    check(ui.profile.open_profile(), "fault store reopens same isolated profile")
    faulty.lose = true
    screen.buttons.play_three.pressed.emit()
    check(not screen.request.is_empty() and not ui.profile.pending.is_empty(), "unknown save keeps frozen quest command")
    var retry: Dictionary = screen.request.duplicate(true)
    check(not screen.buttons.play_three.disabled and screen.buttons.play_three.text.contains(ui.t("ПОВТОРИТЬ", "RETRY")), "visible retry remains usable")
    screen.buttons.play_three.pressed.emit()
    check(screen.request.is_empty() and ui.profile.pending.is_empty() and ui.profile.state().wallet.gold == int(before.wallet.gold) + 75, "readback retry gives exactly one quest reward")
    check(retry.quest == "play_three" and int(retry.day) == int(ui.profile.state().rewards.day), "original quest identity was retained")
    var today: int = ui.rewards_day()
    check(ui.profile.commit({"kind": "rewards_day", "day": today + 1}), "future clock fixture")
    screen.sync_day()
    screen.refresh()
    check(ui.profile.state().rewards.day == today + 1 and screen.buttons.play_one.disabled, "clock rollback cannot reopen quests")
    check(screen.summary.text.contains(ui.t("назад", "back")), "clock rollback explained to player")
    screen.leave()
    var test_snapshot: Dictionary = ui.profile.state()
    ui.start_tutorial()
    ui.game.state.winner = 0
    ui._save_finished_match()
    check(ui.profile.state() == test_snapshot, "tutorial yields neither reward nor statistics")
    ui.show_menu()
    for language in ["ru", "en"]:
        ui.language = language
        for viewport in [Vector2i(720, 1280), Vector2i(1280, 720), Vector2i(640, 480)]:
            root.content_scale_size = viewport
            root.size = viewport
            ui.show_rewards()
            await process_frame
            await process_frame
            screen = ui.find_child("RewardsScreen", true, false)
            var scroll: ScrollContainer = screen.get_parent()
            check(ui.get_viewport_rect().size == Vector2(viewport), "actual rewards viewport")
            check(ui.get_viewport_rect().encloses(scroll.get_global_rect()), "rewards scroll bounds")
            for action in [screen.buttons.play_one, screen.buttons.play_three, screen.find_child("RewardsBack", true, false)]:
                scroll.ensure_control_visible(action)
                await process_frame
                await process_frame
                check(ui.get_viewport_rect().encloses(action.get_global_rect()), "quest action reachable at actual size")
                check(action.size.y >= 62 and action.get_theme_font_size("font_size") >= 19, "no shrinking touch target or font")
            screen.leave()
    var a_before: String = FileAccess.get_sha256(directory.path_join("a.json"))
    var b_before: String = FileAccess.get_sha256(directory.path_join("b.json"))
    ui.profile.enabled = false
    ui.show_rewards()
    check(ui.find_child("RewardsScreen", true, false) == null, "diagnostic mode cannot enter personal rewards")
    ui.start_match()
    ui.game.state.winner = 0
    ui._save_finished_match()
    check(FileAccess.get_sha256(directory.path_join("a.json")) == a_before and FileAccess.get_sha256(directory.path_join("b.json")) == b_before, "diagnostic profile remains byte-identical")
    ui.queue_free()
    await process_frame
    if failures == 0:
        for name in ["a.json", "b.json"]:
            DirAccess.remove_absolute(directory.path_join(name))
        DirAccess.remove_absolute(directory)
        print("MULTIMENTAL_REWARDS_UI_PASS checks=" + str(checks))
    quit(0 if failures == 0 else 1)
