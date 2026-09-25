extends RefCounted
## Real-device storage exercise, isolated from the player's profile and economy.
const Store = preload("res://src/profile_store.gd")
static func run(nonce: String) -> Dictionary:
    if nonce.length() != 48 or not nonce.is_valid_hex_number():
        return {"status": "failed", "error": "invalid_nonce"}
    var directory: String = "user://profile-tests/" + nonce
    var personal_a: String = FileAccess.get_sha256("user://profile/a.json") if FileAccess.file_exists("user://profile/a.json") else "missing"
    var personal_b: String = FileAccess.get_sha256("user://profile/b.json") if FileAccess.file_exists("user://profile/b.json") else "missing"
    var store = Store.new(directory)
    if not store.open_store("").ok:
        return {"status": "failed", "error": "create_profile"}
    var checks: Array[Dictionary] = []
    var command: Dictionary = {"kind": "record_match", "outcome": "win"}
    checks.append({"name": "persist", "ok": store.transact(1, command).ok})
    var reloaded = Store.new(directory)
    checks.append({"name": "reopen", "ok": reloaded.open_store("").ok and reloaded.data.stats.wins == 1})
    if not reloaded.writable:
        return {"status": "failed", "error": "reopen_profile"}
    checks.append({"name": "deduplicate", "ok": bool(reloaded.transact(1, command).get("duplicate", false))})
    checks.append({"name": "locale", "ok": reloaded.transact(2, {"kind": "language", "value": "en"}).ok})
    for sequence in range(3, 73):
        if not reloaded.transact(sequence, command).ok:
            return {"status": "failed", "error": "bounded_journal_write"}
    var final = Store.new(directory)
    var opened: bool = bool(final.open_store("").ok)
    checks.append({"name": "restart_after_compaction", "ok": opened and final.data.stats.wins == 71 and final.data.ordered.receipts.size() == 64})
    checks.append({"name": "old_sequence_rejected", "ok": final.transact(1, command).get("code") == "STALE_SEQUENCE"})
    checks.append({"name": "locale_restored", "ok": opened and final.data.settings.language == "en"})
    var after_a: String = FileAccess.get_sha256("user://profile/a.json") if FileAccess.file_exists("user://profile/a.json") else "missing"
    var after_b: String = FileAccess.get_sha256("user://profile/b.json") if FileAccess.file_exists("user://profile/b.json") else "missing"
    checks.append({"name": "personal_profile_untouched", "ok": personal_a == after_a and personal_b == after_b})
    var passed: bool = true
    for entry in checks:
        passed = passed and bool(entry.ok)
    if passed:
        for name in ["a.json", "b.json"]:
            if DirAccess.remove_absolute(directory.path_join(name)) != OK:
                passed = false
        if DirAccess.remove_absolute(directory) != OK:
            passed = false
    return {"status": "passed" if passed else "failed", "test": "real_profile_storage", "checks": checks, "writes": 72, "personal_profile_untouched": personal_a == after_a and personal_b == after_b}
