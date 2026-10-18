extends SceneTree
const Store = preload("res://src/profile_store.gd")
const Model = preload("res://src/profile_state.gd")
const Journal = preload("res://src/profile_journal.gd")
var checks: int = 0
var failures: int = 0
var folders: Array[String] = []
class FaultStore extends Store:
    var cut: int = -1
    var lose_ack: bool = false
    func _write_slot(filename: String, text: String) -> Error:
        if cut >= 0:
            var file := FileAccess.open(filename, FileAccess.WRITE)
            if file == null:
                return ERR_FILE_CANT_WRITE
            file.store_string(text.substr(0, mini(cut, text.length() - 1)))
            file.flush()
            file.close()
            return ERR_FILE_CANT_WRITE
        var outcome: Error = super._write_slot(filename, text)
        return ERR_FILE_CANT_WRITE if lose_ack and outcome == OK else outcome
func check(value: bool, name: String) -> void:
    checks += 1
    if not value:
        failures += 1
        print("PROFILE_STORAGE_FAIL " + name)
func folder() -> String:
    var value: String = "user://profile-tests/" + Crypto.new().generate_random_bytes(12).hex_encode()
    folders.append(value)
    return value
func write_text(filename: String, value: String) -> void:
    var file := FileAccess.open(filename, FileAccess.WRITE)
    file.store_string(value)
    file.close()
func encode(value: Dictionary, format_number: int = 1) -> String:
    var payload: String = JSON.stringify(value, "", true, true)
    return JSON.stringify({"format": format_number, "payload": payload, "sha256": payload.sha256_text()})
func _initialize() -> void:
    var directory: String = folder()
    var store = Store.new(directory)
    check(store.open_store("").ok, "create profile")
    check(store.data.revision == 1 and store.data.stats.matches == 0, "initial generation")
    var win: Dictionary = {"kind": "record_match", "outcome": "win"}
    check(store.transact(1, win).ok, "persist transaction")
    var restarted = Store.new(directory)
    check(restarted.open_store("").ok and restarted.data.stats.wins == 1, "restore after restart")
    var old_hash: String = FileAccess.get_sha256(directory.path_join("b.json"))
    check(restarted.transact(1, win).duplicate, "duplicate survives restart")
    check(FileAccess.get_sha256(directory.path_join("b.json")) == old_hash, "duplicate performs no rewrite")
    check(not restarted.transact(1, {"kind": "record_match", "outcome": "loss"}).ok, "ID reuse conflict")
    check(restarted.transact(2, {"kind": "language", "value": "en"}).ok, "language persists")
    check(not store.transact(2, win).ok and not store.writable, "stale writer refused")
    var copied: Dictionary = restarted.snapshot()
    copied.wallet.gold = 123
    check(restarted.data.wallet.gold == 0, "snapshot does not expose mutable state")
    for cut in [0, 1, 5, 20, 100, 200, 400, 700, 1200, 5000]:
        var broken = FaultStore.new(folder())
        check(broken.open_store("").ok, "fault fixture")
        check(broken.transact(1, win).ok, "first committed generation")
        broken.cut = cut
        check(not broken.transact(2, win).ok, "interrupted write fails")
        var recover = Store.new(broken.directory)
        check(recover.open_store("").ok and recover.recovered, "recover older valid generation")
        check(recover.data.stats.wins == 1, "no partial transaction observed")
        check(recover.transact(2, win).ok and recover.data.stats.wins == 2, "retry complete transaction")
    var uncertain = FaultStore.new(folder())
    check(uncertain.open_store("").ok, "lost acknowledgement fixture")
    uncertain.lose_ack = true
    check(not uncertain.transact(1, win).ok, "uncertain response not claimed success")
    var reconciled = Store.new(uncertain.directory)
    check(reconciled.open_store("").ok, "readback full committed generation")
    check(reconciled.transact(1, win).duplicate and reconciled.data.stats.wins == 1, "no double result after lost acknowledgement")
    var original: Dictionary = restarted.snapshot()
    write_text(directory.path_join("b.json"), encode(original, 2))
    var future = Store.new(directory)
    check(not future.open_store("").ok and future.last_error == "STORE_UNSUPPORTED", "future envelope does not downgrade")
    write_text(directory.path_join("a.json"), "broken-a")
    write_text(directory.path_join("b.json"), "broken-b")
    check(not future.open_store("").ok, "two corrupt copies do not silently reset")
    check(FileAccess.get_file_as_string(directory.path_join("a.json")) == "broken-a", "preserve corrupt bytes for recovery")
    var conflict: Dictionary = original.duplicate(true)
    conflict.wallet.gold = 1
    write_text(directory.path_join("a.json"), encode(original))
    write_text(directory.path_join("b.json"), encode(conflict))
    check(not future.open_store("").ok and future.last_error == "STORE_CONFLICT", "same revision different bytes refused")
    var legacy_directory: String = folder()
    DirAccess.make_dir_recursive_absolute(legacy_directory)
    var legacy: String = legacy_directory.path_join("settings.cfg")
    write_text(legacy, "[ui]\nlanguage=\"en\"\n[other]\nkeep=7\n")
    var legacy_before: String = FileAccess.get_sha256(legacy)
    var migrated = Store.new(legacy_directory)
    check(migrated.open_store(legacy).ok and migrated.data.settings.language == "en", "existing language migrated")
    check(FileAccess.get_sha256(legacy) == legacy_before, "legacy file untouched")
    write_text(legacy, "[ui]\nlanguage=\"ru\"\n")
    check(migrated.open_store(legacy).ok and migrated.data.settings.language == "en", "migration is once-only")
    var invalid_directory: String = folder()
    DirAccess.make_dir_recursive_absolute(invalid_directory)
    write_text(invalid_directory.path_join("settings.cfg"), "[ui]\nlanguage=\"xx\"\n")
    var invalid = Store.new(invalid_directory)
    check(not invalid.open_store(invalid_directory.path_join("settings.cfg")).ok, "bad legacy value refused")
    check(not FileAccess.file_exists(invalid_directory.path_join("a.json")), "bad migration creates no profile")
    for wrong in ["/tmp/profile", "res://profile", "user://../profile", "user://profile-tests/../../other"]:
        check(not Store.new(wrong).open_store("").ok, "directory restricted")
    for wrong in ["user://profile-tests/.", "user://profile-tests/..", "user://profile-tests/x:y", "user://profile-tests/a/b", "user://profile-tests/"]:
        check(not Store.new(wrong)._safe_directory(), "directory components cannot escape test namespace")
    var journal: Dictionary = Model.fresh("ordered-test")
    for number in range(1, 301):
        var applied: Dictionary = Journal.apply_ordered(journal, number, win)
        check(applied.ok, "ordered transaction " + str(number))
        journal = applied.profile
    check(journal.stats.wins == 300 and journal.ordered.receipts.size() == 64, "bounded journal compaction")
    check(Journal.apply_ordered(journal, 1, win).code == "STALE_SEQUENCE", "compacted operation is never reapplied")
    check(Journal.apply_ordered(journal, 300, win).duplicate, "latest retry recognized")
    check(Journal.apply_ordered(journal, 302, win).code == "SEQUENCE_GAP", "sequence gap refused")
    check(Journal.valid(JSON.parse_string(JSON.stringify(journal))), "compacted journal JSON roundtrip")
    var replay_command: Dictionary = {"kind": "record_match", "outcome": "win", "replay": {"rules": "test", "commands": [{"player": 0, "command": {"type": "pass"}}]}}
    var numeric_profile: Dictionary = Journal.apply_ordered(Model.fresh("numbers"), 1, replay_command).profile
    var parsed_command: Dictionary = JSON.parse_string(JSON.stringify(replay_command))
    check(Journal.apply_ordered(numeric_profile, 1, parsed_command).duplicate, "JSON int-float roundtrip preserves transaction identity")
    var malformed: Dictionary = journal.duplicate(true)
    malformed.ordered.receipts.erase("300")
    check(not Journal.valid(malformed), "missing receipt in retained window rejected")
    var legacy_profile: Dictionary = Model.fresh("legacy-model")
    legacy_profile = Model.apply(legacy_profile, "legacy:1", win).profile
    var ordered_legacy: Dictionary = Journal.apply_ordered(legacy_profile, 1, win)
    check(ordered_legacy.ok and ordered_legacy.profile.receipts == legacy_profile.receipts, "old ID receipts preserved")
    var full = Store.new(folder())
    check(full.open_store("").ok, "oversize fixture")
    var giant: Dictionary = full.snapshot()
    giant.lastMatch["padding"] = "z".repeat(Store.MAX_BYTES)
    check(not full._persist(giant, 2, "b.json").ok, "oversize write refused")
    var full_reopen = Store.new(full.directory)
    check(full_reopen.open_store("").ok and full_reopen.data.revision == 1, "oversize write preserves previous data")
    check(not full_reopen._persist(full_reopen.snapshot(), 1, "b.json").ok, "generation cannot go backwards")
    check(not full_reopen._persist(full_reopen.snapshot(), 2, "../outside.json").ok, "write destination cannot escape slots")
    var lab: Dictionary = preload("res://src/profile_lab.gd").run(Crypto.new().generate_random_bytes(24).hex_encode())
    check(lab.status == "passed" and lab.personal_profile_untouched, "isolated on-device lab runs on actual filesystem")
    if failures == 0:
        for location in folders:
            for name in ["a.json", "b.json", "settings.cfg"]:
                if FileAccess.file_exists(location.path_join(name)):
                    DirAccess.remove_absolute(location.path_join(name))
            DirAccess.remove_absolute(location)
        print("MULTIMENTAL_PROFILE_STORAGE_PASS checks=" + str(checks) + " torn_writes=10 ordered=300")
    quit(0 if failures == 0 else 1)
