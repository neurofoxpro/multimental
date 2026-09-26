extends SceneTree
const Model = preload("res://src/platform/launcher_request.gd")
var checks: int = 0
var failures: int = 0
func check(value: bool, text: String) -> void:
    checks += 1
    if not value:
        failures += 1
        printerr("PRODUCTION_TEST_FAIL: " + text)
func _initialize() -> void:
    var request: Dictionary = {"schemaVersion": 1, "mode": Model.MODE, "nonce": "a".repeat(48), "expectedVersion": "test-version"}
    check(Model.valid(request, "test-version"), "explicit exact developer shortcut request")
    check(Model.valid(JSON.parse_string(JSON.stringify(request)), "test-version"), "actual file JSON is accepted")
    for value in [null, [], {}, "x", true]:
        check(not Model.valid(value, "test-version"), "wrong request type is preserved without a native call")
    for changed in [{"schemaVersion": true}, {"schemaVersion": 2}, {"mode": "other"}, {"nonce": "x".repeat(48)}, {"nonce": "a".repeat(47)}, {"expectedVersion": "old"}, {"extra": 1}]:
        var bad: Dictionary = request.duplicate(true)
        bad.merge(changed, true)
        check(not Model.valid(bad, "test-version"), "invalid packet " + str(changed.keys()))
    check(not Model.valid(request, "new-version"), "old request cannot silently apply to another installed APK")
    check(Model.ID == "multimental-manual-v1" and Model.PACKAGE == "pro.neurofox.multimental.dev", "single developer-owned stable shortcut identity")
    if failures == 0:
        print("MULTIMENTAL_LAUNCHER_REQUEST_PASS checks=" + str(checks) + " native_pin_not_inferred=true")
    quit(0 if failures == 0 else 1)
