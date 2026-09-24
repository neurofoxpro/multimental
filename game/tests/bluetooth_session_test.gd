extends SceneTree
const Session = preload("res://src/net/bluetooth_session.gd")
class FakeRadio:
    extends RefCounted
    var router: Dictionary
    var partner
    var messages: Array[Dictionary] = []
    var status: String = "idle"
    func start(host: bool, _address: String = "") -> Dictionary:
        status = "listening" if host else "connecting"
        if host:
            router.server = self
        elif router.has("server") and router.server.status == "listening":
            partner = router.server
            partner.partner = self
            status = "connected"
            partner.status = "connected"
        return {"ok": true}
    func inspect() -> Dictionary:
        return {"status": status, "detail": ""}
    func take() -> Array[Dictionary]:
        var out: Array[Dictionary] = messages
        messages = []
        return out
    func queue(message: Dictionary) -> void:
        if partner != null and partner.status == "connected":
            partner.messages.append(JSON.parse_string(JSON.stringify(message)))
    func close() -> void:
        status = "closed"
        if partner != null:
            partner.status = "closed"
        partner = null
var failures: int = 0
func check(ok: bool, name: String) -> void:
    if not ok:
        failures += 1
        printerr("PRODUCTION_TEST_FAIL: " + name)
func _initialize() -> void:
    call_deferred("run_test")
func wait_until(fn: Callable, name: String, ms: int = 6000) -> bool:
    var until: int = Time.get_ticks_msec() + ms
    while Time.get_ticks_msec() < until:
        if fn.call():
            return true
        await create_timer(0.02).timeout
    check(false, name)
    return false
func run_test() -> void:
    check(Session.invitation_token("multimental-bt://join/" + "a".repeat(64)) == "a".repeat(64), "Bluetooth invitation")
    check(Session.invitation_token("multimental://join/" + "a".repeat(64)).is_empty(), "transport mismatch")
    if not OS.has_feature("android"):
        check(not BluetoothChannel.available().ok, "no false desktop radio support")
    var router: Dictionary = {}
    var factory: Callable = func():
        var ch = FakeRadio.new()
        ch.router = router
        return ch
    var host = Session.new()
    var guest = Session.new()
    host.channel_factory = factory
    guest.channel_factory = factory
    root.add_child(host)
    root.add_child(guest)
    var made: Dictionary = host.host_room("", 17844, 42)
    check(made.ok, "fake secure adapter starts room")
    guest.join_room(made.invitation)
    if not await wait_until(func(): return guest.connection_status == "connected", "same protocol over Bluetooth adapter"):
        host.stop()
        guest.stop()
        quit(1)
        return
    guest.interrupt_for_test()
    await wait_until(func(): return not host.authority.guest_connected, "host observes radio disconnect")
    await wait_until(func(): return guest.connection_status == "connected" and host.authority.guest_connected, "radio identity reconnect")
    for i in range(30):
        if host.authority.game.state.winner != -1:
            break
        var actor = host if host.authority.game.state.active == 0 else guest
        if not await wait_until(func(): return actor.current_view.get("active", 1) == 0 and actor.pending.is_empty(), "active peer synced"):
            break
        var turn: int = host.authority.game.state.turn
        check(actor.submit(actor.current_view.legal[0]).ok, "Bluetooth session command")
        await wait_until(func(): return host.authority.game.state.turn > turn or host.authority.game.state.winner != -1, "Bluetooth command reaches authority")
    await wait_until(func(): return guest.current_view.get("winner", -1) != -1, "Bluetooth result reaches guest")
    check(host.authority.game.state.winner != -1, "Bluetooth model match complete")
    check(not guest.current_view.has("players"), "no private deck in Bluetooth projection")
    host.stop()
    guest.stop()
    host.queue_free()
    guest.queue_free()
    router.clear()
    await process_frame
    if failures == 0:
        print("MULTIMENTAL_BLUETOOTH_MODEL_PASS fake_transport=true completed_match=true reconnect=true")
    quit(0 if failures == 0 else 1)
