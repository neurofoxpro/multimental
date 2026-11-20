extends "res://src/collection_device_lab.gd"
## Five external taps, three explicit API match fixtures, no personal profile writes.
const Policy = preload("res://src/rewards_policy.gd")
func _ready() -> void:
    test_name = "real_rewards_quests"
    fixture_cards_added = 0
    super._ready()
func entry(stage: String) -> bool:
    var control: Button = ui.find_child("OpenRewards", true, false)
    ui.root.get_parent().ensure_control_visible(control)
    return await _tap(control, stage, func(): return ui.find_child("RewardsScreen", true, false) != null)
func run_lab() -> void:
    before = personal_hashes()
    if not OS.is_debug_build() or nonce.length() != 48:
        _finish("invalid_debug_request")
        return
    for letter in nonce:
        if not letter in "0123456789abcdef":
            _finish("invalid_nonce")
            return
    original = ui.profile
    original_processing = ui.is_processing()
    ui.set_process(false)
    var directory: String = "user://profile-tests/device-rewards-" + nonce
    var fixture = Controller.new()
    fixture.storage = Store.new(directory)
    fixture.legacy_settings = ""
    if not fixture.open_profile():
        _finish("fixture_open_failed")
        return
    for number in range(1, 4):
        var command: Dictionary = {"kind": "reward_match", "policy": Policy.POLICY, "matchNumber": number, "outcome": "win", "day": ui.rewards_day(), "replay": {"rules": "device-fixture", "commands": [], "session": "fixture-" + str(number)}}
        if not fixture.commit(command):
            _finish("fixture_result_failed")
            return
    checks.append({"name": "fixture_matches_added_by_api", "ok": true, "count": 3})
    ui.profile = fixture
    ui.show_menu()
    if not await entry("waiting_rewards_open"):
        _finish("entry_tap_failed")
        return
    var screen = ui.find_child("RewardsScreen", true, false)
    screen.get_parent().ensure_control_visible(screen.buttons.play_one)
    if not await _tap(screen.buttons.play_one, "waiting_rewards_one", func(): return "play_one" in fixture.state().rewards.claimed):
        _finish("first_claim_tap_failed")
        return
    screen.get_parent().ensure_control_visible(screen.buttons.play_three)
    if not await _tap(screen.buttons.play_three, "waiting_rewards_three", func(): return "play_three" in fixture.state().rewards.claimed):
        _finish("third_claim_tap_failed")
        return
    var expected_gold: int = 3 * int(Policy.match_reward("win").gold) + int(Policy.QUESTS.play_one.gold) + int(Policy.QUESTS.play_three.gold)
    var expected_xp: int = 3 * int(Policy.match_reward("win").xp) + int(Policy.QUESTS.play_one.xp) + int(Policy.QUESTS.play_three.xp)
    var correct: bool = int(fixture.state().wallet.gold) == expected_gold and int(fixture.state().rewards.xp) == expected_xp and int(fixture.state().stats.matches) == 3
    checks.append({"name": "claims_and_balances_exact", "ok": correct})
    if not correct:
        _finish("incorrect_reward_totals")
        return
    var back: Button = screen.find_child("RewardsBack", true, false)
    screen.get_parent().ensure_control_visible(back)
    if not await _tap(back, "waiting_rewards_back", func(): return ui.find_child("RewardsScreen", true, false) == null):
        _finish("back_tap_failed")
        return
    var reopened = Store.new(directory)
    var restored: bool = reopened.open_store("").ok and reopened.data.wallet.gold == expected_gold and reopened.data.rewards.claimed.size() == 2
    checks.append({"name": "claimed_rewards_reopened_from_disk", "ok": restored})
    if not restored:
        _finish("reopen_failed")
        return
    if not await entry("waiting_rewards_reopen"):
        _finish("reopen_tap_failed")
        return
    screen = ui.find_child("RewardsScreen", true, false)
    var locked: bool = screen.buttons.play_one.disabled and screen.buttons.play_three.disabled
    checks.append({"name": "claimed_buttons_disabled", "ok": locked})
    _finish("" if locked else "claim_can_repeat")
