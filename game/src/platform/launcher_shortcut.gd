extends Node
## Owner-requested developer shortcut only. No request file means no platform side effects.
const Model = preload("res://src/platform/launcher_request.gd")
const REQUEST: String = "user://automation-launcher-request.json"
const RESULT: String = "user://automation-launcher-result.json"
var nonce: String = ""
var manager: Variant
var failed: bool = false
var requested: bool = false
var done: bool = false
var deadline: int = 0
var next_poll: int = 0

func _ready() -> void:
    set_process(false)
    if not OS.is_debug_build() or not OS.has_feature("android") or not FileAccess.file_exists(REQUEST):
        return
    var file := FileAccess.open(REQUEST, FileAccess.READ)
    if file == null or file.get_length() > 512:
        return
    var value: Variant = JSON.parse_string(file.get_as_text())
    file.close()
    if not Model.valid(value, BuildInfo.VERSION):
        return
    nonce = value.nonce
    if DirAccess.remove_absolute(REQUEST) != OK:
        return
    _publish("starting")
    deadline = Time.get_ticks_msec() + 45000
    set_process(true)
    call_deferred("_begin")

func _publish(status: String, code: String = "") -> void:
    if done:
        return
    var terminal: bool = status in ["pinned", "unsupported", "failed", "not_confirmed"]
    var record: Dictionary = {"schemaVersion": 1, "mode": Model.MODE, "nonce": nonce, "package": Model.PACKAGE, "version": BuildInfo.VERSION, "sourceCommit": BuildInfo.COMMIT, "shortcutId": Model.ID, "status": status, "code": code, "requestAccepted": requested, "homePositionVerified": false}
    var file := FileAccess.open(RESULT, FileAccess.WRITE)
    if file != null:
        file.store_string(JSON.stringify(record))
        file.close()
    if terminal:
        done = true
        set_process(false)

func _call(object: Variant, method: String, args: Array = []) -> Variant:
    if failed or object == null:
        failed = true
        call_deferred("_publish", "failed", "native_object_unavailable")
        return null
    var value: Variant = object.callv(method, args)
    if JavaClassWrapper.get_exception() != null:
        failed = true
        call_deferred("_publish", "failed", "native_call_" + method)
        return null
    return value

func _class(name: String) -> Variant:
    if failed:
        return null
    var value: Variant = JavaClassWrapper.wrap(name)
    if value == null or JavaClassWrapper.get_exception() != null:
        failed = true
        call_deferred("_publish", "failed", "native_class_unavailable")
        return null
    return value

func _begin() -> void:
    var runtime: Variant = Engine.get_singleton("AndroidRuntime")
    var activity: Variant = _call(runtime, "getActivity")
    if failed or _call(activity, "getPackageName") != Model.PACKAGE:
        _publish("failed", "wrong_application")
        return
    var runnable: Variant = _call(runtime, "createRunnableFromGodotCallable", [_request_pin.bind(activity)])
    _call(activity, "runOnUiThread", [runnable])

func _request_pin(activity: Variant) -> void:
    manager = _call(activity, "getSystemService", ["shortcut"])
    var supported: Variant = _call(manager, "isRequestPinShortcutSupported")
    if failed:
        return
    if supported != true:
        call_deferred("_publish", "unsupported", "launcher_does_not_support_pin")
        return
    var current: Variant = _call(manager, "getPinnedShortcuts")
    var current_count: Variant = _call(current, "size")
    if failed or typeof(current_count) != TYPE_INT or current_count < 0 or current_count > 128:
        return
    for i in range(int(current_count)):
        var item: Variant = _call(current, "get", [i])
        if _call(item, "getId") == Model.ID and _call(item, "isEnabled") == true:
            call_deferred("_publish", "pinned", "already_pinned")
            return
    var pm: Variant = _call(activity, "getPackageManager")
    var intent: Variant = _call(pm, "getLaunchIntentForPackage", [Model.PACKAGE])
    _call(intent, "setAction", ["android.intent.action.MAIN"])
    var app_info: Variant = _call(activity, "getApplicationInfo")
    if failed or app_info == null:
        return
    var icon_id: int = int(app_info.icon)
    if JavaClassWrapper.get_exception() != null or icon_id == 0:
        failed = true
        call_deferred("_publish", "failed", "missing_application_icon")
        return
    var icon: Variant = _call(_class("android.graphics.drawable.Icon"), "createWithResource", [activity, icon_id])
    var builder: Variant = _call(_class("android.content.pm.ShortcutInfo$Builder"), "Builder", [activity, Model.ID])
    _call(builder, "setShortLabel", ["Multimental Dev"])
    _call(builder, "setLongLabel", ["Multimental Dev"])
    _call(builder, "setIcon", [icon])
    _call(builder, "setIntent", [intent])
    var shortcut: Variant = _call(builder, "build")
    var accepted: Variant = _call(manager, "requestPinShortcut", [shortcut, null])
    if failed:
        return
    requested = accepted == true
    call_deferred("_publish", "requested" if requested else "unsupported", "" if requested else "pin_request_rejected")

func _process(_delta: float) -> void:
    if done or failed:
        return
    var ticks: int = Time.get_ticks_msec()
    if ticks >= deadline:
        _publish("not_confirmed", "launcher_confirmation_not_observed")
        return
    if not requested or manager == null or ticks < next_poll:
        return
    next_poll = ticks + 350
    var shortcuts: Variant = _call(manager, "getPinnedShortcuts")
    var count: Variant = _call(shortcuts, "size")
    if failed or typeof(count) != TYPE_INT or count < 0 or count > 128:
        return
    for i in range(int(count)):
        var item: Variant = _call(shortcuts, "get", [i])
        if _call(item, "getId") == Model.ID and _call(item, "isEnabled") == true:
            _publish("pinned")
            return
