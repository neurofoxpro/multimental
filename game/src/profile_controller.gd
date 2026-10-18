extends RefCounted
## Single UI writer. Pending operations keep their sequence across an uncertain reply.
const Store = preload("res://src/profile_store.gd")
var storage = Store.new()
var enabled: bool = true
var legacy_settings: String = "user://settings.cfg"
var pending: Dictionary = {}
var error: String = ""
var recovered: bool = false

func open_profile() -> bool:
    var result: Dictionary = storage.open_store(legacy_settings, enabled)
    error = "" if result.ok else str(result.code)
    recovered = bool(result.get("recovered", false))
    return result.ok

func state() -> Dictionary:
    return storage.snapshot()

func language(fallback: String = "ru") -> String:
    return str(storage.data.get("settings", {}).get("language", fallback))

func commit(command: Dictionary) -> bool:
    if not enabled:
        return true
    if not pending.is_empty():
        var same: bool = pending.command == command
        if not flush():
            return false
        if same:
            return true
    if not storage.writable and not open_profile():
        return false
    pending = {"sequence": storage.next_sequence(), "command": command.duplicate(true)}
    return flush()

func flush() -> bool:
    if not enabled or pending.is_empty():
        return true
    if not storage.writable and not open_profile():
        return false
    var result: Dictionary = storage.transact(int(pending.sequence), pending.command)
    if not result.ok:
        error = str(result.code)
        return false
    pending.clear()
    error = ""
    return true
