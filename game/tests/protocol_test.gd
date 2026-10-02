extends SceneTree
const Protocol = preload("res://src/session_protocol.gd")
var failures: int = 0
var checks: int = 0
func check(value: bool, message: String) -> void:
    checks += 1
    if not value:
        failures += 1
        printerr("PRODUCTION_TEST_FAIL: " + message)
func _initialize() -> void:
    var secret: String = "test-secret-1234567890"
    var p = Protocol.new(secret)
    var before: Dictionary = p.view()
    check(not p.receive({"v": 99, "token": secret, "op": "hello"}).ok, "protocol mismatch")
    check(not p.receive({"v": 1.5, "token": secret, "op": "hello"}).ok, "fractional protocol")
    check(not p.receive({"v": 1, "token": "wrong", "op": "hello"}).ok, "token mismatch")
    check(not p.receive({"v": 1, "token": secret, "op": "sync"}).ok, "handshake required")
    check(before == p.view(), "invalid handshake no mutation")
    var hello: Dictionary = p.receive({"v": 1, "token": secret, "op": "hello"})
    check(hello.ok, "handshake")
    check(not hello.view.has("seed") and not hello.view.has("players") and not hello.view.has("deck"), "private information filtered")
    var command: Dictionary = {"v": 1, "token": secret, "op": "command", "seq": 1, "command": {"type": "pass"}}
    var result: Dictionary = p.receive(command)
    var after: Dictionary = p.view()
    check(result.ok and p.receive(command) == result, "idempotent replay")
    check(after == p.view(), "duplicate did not act twice")
    check(p.receive({"v": 1, "token": secret, "op": "command", "seq": 1, "command": {"type": "invalid"}}).error == "duplicate_conflict", "duplicate conflict")
    check(p.receive({"v": 1, "token": secret, "op": "command", "seq": 8, "command": {"type": "pass"}}).error == "out_of_order", "out of order")
    check(p.receive({"v": 1, "token": secret, "op": "sync"}).view == after, "resync")
    var wire = Protocol.new(secret)
    var wire_hello: Dictionary = wire.receive(JSON.parse_string(JSON.stringify({"v": 1, "token": secret, "op": "hello"})))
    var move: Dictionary = wire_hello.view.legal[0]
    var wire_result: Dictionary = wire.receive(JSON.parse_string(JSON.stringify({"v": 1, "token": secret, "op": "command", "seq": 1, "command": move})))
    check(wire_result.ok, "real JSON wire command")
    check(wire.receive({"v": 1, "token": secret, "op": "command", "seq": 2, "command": {"type": "play", "hand": 0.5, "cell": 0, "direction": 0}}).error == "invalid_command_number", "fraction rejected")
    check(wire.receive({"v": 1, "token": secret, "op": "command", "seq": 2.5, "command": {"type": "pass"}}).error == "invalid_sequence", "fractional sequence")
    check(wire.receive({"v": 1, "token": secret, "op": "command", "seq": 2, "command": {"type": "pass", "admin": true}}).error == "unknown_command_field", "unknown field")
    if failures == 0:
        print("MULTIMENTAL_PROTOCOL_PASS checks=%d" % checks)
    quit(0 if failures == 0 else 1)
