extends RefCounted
## Two complete, checksummed generations. Never truncate the current good slot.
const Model = preload("res://src/profile_state.gd")
const Journal = preload("res://src/profile_journal.gd")
const MAX_BYTES: int = 2097152
var directory: String
var data: Dictionary = {}
var writable: bool = false
var last_error: String = "NOT_OPEN"
var recovered: bool = false
var _slot: String = ""
var _digest: String = ""
static var _busy: Dictionary = {}

func _init(folder: String = "user://profile") -> void:
    directory = folder

func _safe_directory() -> bool:
    if directory == "user://profile":
        return true
    if not directory.begins_with("user://profile-tests/"):
        return false
    var name: String = directory.trim_prefix("user://profile-tests/")
    if name.is_empty() or name.length() > 96:
        return false
    for character in name:
        if not character in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-":
            return false
    return true

func snapshot() -> Dictionary:
    return data.duplicate(true)

func _fail(code: String) -> Dictionary:
    last_error = code
    return {"ok": false, "code": code}

func _read_slot(name: String) -> Dictionary:
    var filename: String = directory.path_join(name)
    if not FileAccess.file_exists(filename):
        return {"status": "missing", "slot": name}
    var file := FileAccess.open(filename, FileAccess.READ)
    if file == null:
        return {"status": "unreadable", "slot": name}
    if file.get_length() <= 0 or file.get_length() > MAX_BYTES:
        file.close()
        return {"status": "corrupt", "slot": name}
    var text: String = file.get_as_text()
    file.close()
    var parser := JSON.new()
    if parser.parse(text) != OK or typeof(parser.data) != TYPE_DICTIONARY:
        return {"status": "corrupt", "slot": name}
    var envelope: Dictionary = parser.data
    if typeof(envelope.get("payload")) != TYPE_STRING or typeof(envelope.get("sha256")) != TYPE_STRING:
        return {"status": "corrupt", "slot": name}
    if envelope.payload.sha256_text() != envelope.sha256:
        return {"status": "corrupt", "slot": name}
    if envelope.get("format") != 1 or parser.parse(envelope.payload) != OK or typeof(parser.data) != TYPE_DICTIONARY:
        return {"status": "unsupported", "slot": name}
    var value: Dictionary = parser.data
    if value.get("schemaVersion") != Model.SCHEMA:
        return {"status": "unsupported", "slot": name}
    if typeof(value.get("collection")) == TYPE_DICTIONARY and value.collection.get("version") != 1:
        return {"status": "unsupported", "slot": name}
    if typeof(value.get("economy")) == TYPE_DICTIONARY and value.economy.get("version") != 1:
        return {"status": "unsupported", "slot": name}
    if typeof(value.get("crafting")) == TYPE_DICTIONARY and (value.crafting.get("version") != 1 or value.crafting.get("policy") != preload("res://src/crafting_policy.gd").POLICY):
        return {"status": "unsupported", "slot": name}
    if not Journal.valid(value):
        return {"status": "corrupt", "slot": name}
    return {"status": "valid", "slot": name, "data": value, "digest": envelope.sha256}

func _scan() -> Dictionary:
    var a: Dictionary = _read_slot("a.json")
    var b: Dictionary = _read_slot("b.json")
    for row in [a, b]:
        if row.status in ["unsupported", "unreadable"]:
            return {"status": row.status}
    if a.status == "missing" and b.status == "missing":
        return {"status": "missing"}
    if a.status != "valid" and b.status != "valid":
        return {"status": "corrupt"}
    if a.status == "valid" and b.status == "valid":
        if a.data.profileId != b.data.profileId:
            return {"status": "conflict"}
        if a.data.revision == b.data.revision and a.digest != b.digest:
            return {"status": "conflict"}
        return a if int(a.data.revision) >= int(b.data.revision) else b
    var selected: Dictionary = a if a.status == "valid" else b
    selected.recovered = a.status == "corrupt" or b.status == "corrupt"
    return selected

func _adopt(row: Dictionary) -> void:
    data = row.data.duplicate(true)
    _slot = str(row.slot)
    _digest = str(row.digest)
    recovered = bool(row.get("recovered", false))
    writable = true
    last_error = ""

func open_store(legacy_settings: String = "user://settings.cfg", allow_create: bool = true) -> Dictionary:
    writable = false
    if not _safe_directory():
        return _fail("INVALID_DIRECTORY")
    if _busy.has(directory):
        return _fail("STORE_BUSY")
    var row: Dictionary = _scan()
    if row.status == "valid":
        _adopt(row)
        return {"ok": true, "created": false, "recovered": recovered}
    if row.status != "missing":
        return _fail("STORE_" + str(row.status).to_upper())
    if not allow_create:
        return _fail("READ_ONLY_NO_PROFILE")
    if legacy_settings not in ["", "user://settings.cfg", directory.path_join("settings.cfg")]:
        return _fail("INVALID_LEGACY_PATH")
    var initial: Dictionary = Model.fresh(Crypto.new().generate_random_bytes(16).hex_encode())
    if legacy_settings != "" and FileAccess.file_exists(legacy_settings):
        var cfg := ConfigFile.new()
        if cfg.load(legacy_settings) != OK:
            return _fail("LEGACY_SETTINGS_UNREADABLE")
        var language: Variant = cfg.get_value("ui", "language", "ru")
        if language not in ["ru", "en"]:
            return _fail("LEGACY_LANGUAGE_INVALID")
        initial.settings.language = language
    if DirAccess.make_dir_recursive_absolute(directory) != OK:
        return _fail("DIRECTORY_CREATE_FAILED")
    _busy[directory] = true
    var result: Dictionary = _persist(initial, 1, "a.json")
    _busy.erase(directory)
    return result

func next_sequence() -> int:
    return int(data.get("ordered", {}).get("head", 0)) + 1

func transact(sequence: int, command: Dictionary) -> Dictionary:
    if not writable or not _safe_directory():
        return _fail("STORE_NOT_WRITABLE")
    if _busy.has(directory):
        return _fail("STORE_BUSY")
    _busy[directory] = true
    var result: Dictionary = _transact_locked(sequence, command)
    _busy.erase(directory)
    return result

func _transact_locked(sequence: int, command: Dictionary) -> Dictionary:
    var current: Dictionary = _scan()
    if current.status != "valid" or current.digest != _digest:
        writable = false
        return _fail("STORE_CHANGED_REOPEN")
    var result: Dictionary = Journal.apply_ordered(data, sequence, command)
    if not result.ok:
        return _fail(str(result.code))
    if result.duplicate:
        return {"ok": true, "duplicate": true}
    if int(data.revision) >= Model.LIMIT:
        return _fail("REVISION_EXHAUSTED")
    return _persist(result.profile, int(data.revision) + 1, "b.json" if _slot == "a.json" else "a.json")

func _persist(value: Dictionary, revision: int, slot: String) -> Dictionary:
    if slot not in ["a.json", "b.json"] or slot == _slot or not Model.count_value(revision) or revision != int(data.get("revision", 0)) + 1:
        return _fail("INVALID_DESTINATION")
    var next: Dictionary = value.duplicate(true)
    next.revision = revision
    if not Journal.valid(next):
        return _fail("INVALID_PROFILE")
    var payload: String = JSON.stringify(next, "", true, true)
    var encoded: String = JSON.stringify({"format": 1, "payload": payload, "sha256": payload.sha256_text()})
    if encoded.to_utf8_buffer().size() > MAX_BYTES:
        return _fail("PROFILE_TOO_LARGE")
    var error: Error = _write_slot(directory.path_join(slot), encoded)
    if error != OK:
        writable = false
        return _fail("WRITE_UNCERTAIN_REOPEN")
    var verified: Dictionary = _read_slot(slot)
    if verified.status != "valid" or verified.digest != payload.sha256_text():
        writable = false
        return _fail("WRITE_VERIFY_FAILED")
    _adopt(verified)
    return {"ok": true, "duplicate": false, "revision": revision}

func _write_slot(filename: String, text: String) -> Error:
    var file := FileAccess.open(filename, FileAccess.WRITE)
    if file == null:
        return FileAccess.get_open_error()
    file.store_string(text)
    file.flush()
    var error: Error = file.get_error()
    file.close()
    return error
