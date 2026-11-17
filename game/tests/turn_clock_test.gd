extends SceneTree
const Clock = preload("res://src/turn_clock.gd")
const Room = preload("res://src/net/room_rules.gd")
var checks: int = 0
var failures: int = 0
func check(ok: bool, detail: String) -> void:
    checks += 1
    if not ok:
        failures += 1
        printerr("TURN_CLOCK_FAIL " + detail)
func _initialize() -> void:
    check(Clock.millis_for_turn(1) == 90000 and Clock.millis_for_turn(2) == 90000, "first own turn has 90 seconds for both players")
    check(Clock.millis_for_turn(3) == 95000 and Clock.millis_for_turn(4) == 95000, "second own turn has 95 seconds")
    check(Clock.millis_for_turn(5) == 100000 and Clock.millis_for_turn(6) == 100000, "third own turn has 100 seconds")
    check(Clock.millis_for_turn(7) == 105000, "each subsequent own turn gains another 5 seconds")
    check(Clock.text_for_seconds(90) == "1:30" and Clock.text_for_seconds(95) == "1:35" and Clock.text_for_seconds(100) == "1:40", "clear clock display")
    check(Clock.text_for_seconds(-4) == "0:00", "negative remainder is clamped")
    var room = Room.new()
    var secret: String = "a".repeat(64)
    var guest: String = "b".repeat(64)
    check(room.configure(42, secret, 0).ok, "room configured")
    check(room.turn_deadline == 90000 and room.paused_remaining == 90000, "waiting room clock is 90 seconds")
    check(room.connect_guest(secret, guest, 0).ok, "room connected")
    room.tick(89999)
    check(room.game.commands.is_empty() and room.view_for(0).turn_remaining_ms == 1, "first turn is not timed out early")
    room.tick(90000)
    check(room.game.commands.size() == 1 and int(room.game.state.turn) == 2, "first timeout advances exactly once")
    check(room.turn_deadline == 180000 and room.view_for(0).turn_remaining_ms == 90000, "second player gets 90 seconds")
    room.tick(180000)
    check(room.game.commands.size() == 2 and int(room.game.state.turn) == 3, "second timeout advances turn")
    check(room.turn_deadline == 275000 and room.view_for(0).turn_remaining_ms == 95000, "first player's second turn gains 5 seconds")
    room.tick(274999)
    check(room.game.state.winner == -1, "second own turn not timed out early")
    room.tick(275000)
    check(room.phase == "finished" and room.game.state.reason == "timeout", "two missed own turns lose at the new deadline")
    room.configure(42, secret, 0)
    room.connect_guest(secret, guest, 0)
    room.tick(900000)
    check(room.game.state.reason == "limit", "original 15 minute match cap is preserved")
    if failures == 0:
        print("MULTIMENTAL_TURN_CLOCK_PASS checks=" + str(checks))
    quit(0 if failures == 0 else 1)
