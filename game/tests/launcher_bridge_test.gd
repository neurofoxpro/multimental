extends SceneTree
const Model = preload("res://src/platform/launcher_request.gd")
var checks: int = 0
var failures: int = 0
class FakeNative extends "res://src/platform/launcher_shortcut.gd":
    var support: Variant = 1
    var accepted: Variant = 1
    var enabled: Variant = 1
    var pin_exists: bool = false
    var icon_value: Variant = 1
    var invoked: Array[String] = []
    var statuses: Array[Dictionary] = []
    func _call(_object: Variant, method: String, _args: Array = []) -> Variant:
        invoked.append(method)
        match method:
            "isRequestPinShortcutSupported": return support
            "requestPinShortcut": return accepted
            "isEnabled": return enabled
            "size": return 1 if pin_exists else 0
            "getId": return Model.ID
            "getIconResource": return icon_value
            _: return self
    func _class(_name: String) -> Variant:
        return self
    func _publish(status: String, code: String = "") -> void:
        statuses.append({"status": status, "code": code})
func check(value: bool, title: String) -> void:
    checks += 1
    if not value:
        failures += 1
        printerr("PRODUCTION_TEST_FAIL: " + title)
func _initialize() -> void:
    call_deferred("run_test")
func run_test() -> void:
    for value in [true, false, 0, 1]:
        var result: Dictionary = Model.native_flag(value)
        check(result.ok and typeof(result.value) == TYPE_BOOL, "JNI bool/int has a strict bool result")
        check(result.value == (value if typeof(value) == TYPE_BOOL else value == 1), "JNI bit preserves meaning")
    for value in [null, "true", "false", "0", "1", 2, -1, 0.0, 1.0, [], {}]:
        var result: Dictionary = Model.native_flag(value)
        check(not result.ok and result.value == false, "invalid JNI boolean rejected: " + str(value))
    for bit in [true, 1]:
        var bridge := FakeNative.new()
        root.add_child(bridge)
        bridge.support = bit
        bridge.accepted = bit
        bridge._request_pin(bridge)
        await process_frame
        check(not bridge.failed and bridge.requested, "both actual true representations request the pin")
        check(bridge.invoked.count("requestPinShortcut") == 1, "single native request")
        check(bridge.invoked.has("getActivityInfo") and bridge.invoked.has("getIconResource") and not bridge.invoked.has("getApplicationInfo"), "icon metadata uses Java methods, not fake dictionary fields")
        check(bridge.statuses.back().status == "requested", "native submission is not yet a pinned icon")
        bridge.queue_free()
        await process_frame
    for bit in [false, 0]:
        var bridge := FakeNative.new()
        root.add_child(bridge)
        bridge.support = bit
        bridge._request_pin(bridge)
        await process_frame
        check(not bridge.requested and not bridge.invoked.has("requestPinShortcut"), "unsupported launcher has no pin mutation")
        check(bridge.statuses.back().status == "unsupported", "unsupported is explicit")
        bridge.queue_free()
        await process_frame
    var invalid := FakeNative.new()
    root.add_child(invalid)
    invalid.support = "true"
    invalid._request_pin(invalid)
    await process_frame
    check(invalid.failed and not invalid.invoked.has("requestPinShortcut"), "malformed capability never submits")
    check(invalid.statuses.back().code == "invalid_native_boolean_isRequestPinShortcutSupported", "wrong native type fails immediately instead of waiting for timeout")
    invalid.queue_free()
    await process_frame
    for value in [null, true, 0, -1, 1.0, "1", 2147483648]:
        var missing := FakeNative.new()
        root.add_child(missing)
        missing.icon_value = value
        missing._request_pin(missing)
        await process_frame
        check(missing.failed and missing.statuses.back().code == "missing_application_icon", "invalid native icon ID is explicit")
        check(not missing.invoked.has("requestPinShortcut"), "invalid icon never submits a pin")
        missing.queue_free()
        await process_frame
    var exists := FakeNative.new()
    root.add_child(exists)
    exists.pin_exists = true
    exists._request_pin(exists)
    await process_frame
    check(not exists.failed and exists.statuses.back().code == "already_pinned", "existing enabled JNI-int shortcut is recognized")
    check(not exists.invoked.has("requestPinShortcut"), "existing enabled shortcut not duplicated")
    exists.queue_free()
    await process_frame
    var poll := FakeNative.new()
    root.add_child(poll)
    poll.manager = poll
    poll.requested = true
    poll.pin_exists = true
    poll.deadline = Time.get_ticks_msec() + 10000
    poll._process(0)
    check(poll.statuses.back().status == "pinned", "JNI-int isEnabled also works in post-request polling")
    poll.queue_free()
    await process_frame
    if failures == 0:
        print("MULTIMENTAL_LAUNCHER_BRIDGE_PASS checks=" + str(checks) + " simulated_native=true")
    quit(0 if failures == 0 else 1)
