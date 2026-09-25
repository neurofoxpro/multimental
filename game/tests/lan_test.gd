extends SceneTree
const Session = preload("res://src/net/lan_session.gd")
const Invite = preload("res://src/net/room_invite.gd")
var failures: int = 0
var host
var guest
func check(value: bool, label_text: String) -> void:
    if not value:
        failures += 1
        printerr("PRODUCTION_TEST_FAIL: " + label_text)
func _initialize() -> void:
    call_deferred("run_test")
func wait_until(predicate: Callable, label_text: String, milliseconds: int = 7000) -> bool:
    var end: int = Time.get_ticks_msec() + milliseconds
    while Time.get_ticks_msec() < end:
        if predicate.call():
            return true
        await create_timer(0.02).timeout
    check(false, label_text)
    return false
func run_test() -> void:
    host = Session.new()
    guest = Session.new()
    root.add_child(host)
    root.add_child(guest)
    print("TLS_TEST_PHASE host_create")
    var made: Dictionary = host.host_room("127.0.0.1", 17844, 42)
    check(made.ok, "host creates TLS room")
    if not made.ok:
        quit(1)
        return
    print("TLS_TEST_PHASE wrong_certificate")
    var bad = Session.new()
    root.add_child(bad)
    var data: Dictionary = Invite.decode(made.invitation).invite
    bad.join_room(Invite.encode(data.address, data.port, "0".repeat(64), data.token))
    await wait_until(func(): return bad.connection_status == "certificate_mismatch", "wrong pinned certificate fails")
    check(not host.authority.guest_connected, "bad certificate reveals no player state")
    bad.stop()
    bad.queue_free()
    print("TLS_TEST_PHASE join_correct")
    check(guest.join_room(made.invitation).ok, "guest accepts invitation")
    if not await wait_until(func(): return guest.connection_status == "connected", "TLS guest handshake"):
        host.stop()
        guest.stop()
        quit(1)
        return
    check(host.authority.guest_connected and not guest.current_view.has("players"), "authenticated role and private view")
    var turns: int = int(host.authority.game.state.turn)
    print("TLS_TEST_PHASE reconnect")
    guest.interrupt_for_test()
    await wait_until(func(): return not host.authority.guest_connected, "host detects disconnection")
    await wait_until(func(): return guest.connection_status == "connected" and host.authority.guest_connected, "automatic same-identity reconnect")
    check(host.authority.game.state.turn == turns, "reconnect does not replay a new turn")
    print("TLS_TEST_PHASE match_actions")
    var previous: int = int(host.authority.revision)
    var acted: int = 0
    for step in range(100):
        if host.authority.game.state.winner != -1:
            break
        var active: int = int(host.authority.game.state.active)
        var actor = host if active == 0 else guest
        if not await wait_until(func(): return not actor.current_view.is_empty() and actor.current_view.active == 0 and actor.pending.is_empty(), "correct player's view catches up"):
            break
        var options: Array = actor.current_view.legal
        check(not options.is_empty(), "player has legal actions")
        if options.is_empty():
            break
        var result: Dictionary = actor.submit(options[0])
        check(result.ok, "player command submitted")
        if not await wait_until(func(): return host.authority.revision > previous or host.authority.game.state.winner != -1, "authoritative command advances"):
            break
        previous = int(host.authority.revision)
        acted += 1
    check(host.authority.game.state.winner != -1 and acted >= 5, "real TLS match reaches a result")
    await wait_until(func(): return not guest.current_view.is_empty() and guest.current_view.winner != -1, "result delivered to both players")
    check(host.current_view.winner != guest.current_view.winner or host.current_view.winner == 2, "winner is player-relative")
    print("TLS_TEST_PHASE cleanup")
    host.stop()
    guest.stop()
    host.queue_free()
    guest.queue_free()
    await process_frame
    if failures == 0:
        print("MULTIMENTAL_LAN_PASS tls=true certificate_pin=true reconnect=true completed_match=true")
    quit(0 if failures == 0 else 1)
