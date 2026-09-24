extends SceneTree
const Protocol = preload("res://src/session_protocol.gd")
var failures: int = 0
func check(value: bool, message: String) -> void:
    if not value:
        failures += 1
        printerr("PRODUCTION_TEST_FAIL: " + message)
func _initialize() -> void:
    var secret: String = "test-secret-1234567890"
    var p = Protocol.new(secret)
    var before: Dictionary = p.view()
    check(not p.receive({"v": 99, "token": secret, "op": "hello"}).ok, "protocol mismatch")
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
    check(after == p.view(), "duplicate command did not act twice")
    check(p.receive({"v": 1, "token": secret, "op": "command", "seq": 1, "command": {"type": "invalid"}}).error == "duplicate_conflict", "duplicate conflict")
    check(p.receive({"v": 1, "token": secret, "op": "command", "seq": 8, "command": {"type": "pass"}}).error == "out_of_order", "out of order")
    check(p.receive({"v": 1, "token": secret, "op": "sync"}).view == after, "resync")
    if failures == 0:
        print("MULTIMENTAL_PROTOCOL_PASS checks=11")
    quit(0 if failures == 0 else 1)
