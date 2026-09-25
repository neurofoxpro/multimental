class_name RoomRules
extends RefCounted
## Pure host authority. Time and randomness are injected; no nodes or transport.
const Core = preload("res://src/match_core.gd")
const VERSION: int = 2
const RULES: String = Core.RULES_ID
const TURN_MS: int = 30000
const MATCH_MS: int = 900000
const RECONNECT_MS: int = 60000
var game = Core.new()
var secret: String = ""
var guest_identity: String = ""
var guest_connected: bool = false
var phase: String = "waiting"
var revision: int = 0
var next_sequence: Array[int] = [1, 1]
var receipts: Array[Dictionary] = [{}, {}]
var last_now: int = 0
var turn_deadline: int = 0
var match_deadline: int = 0
var reconnect_deadline: int = 0
var paused_remaining: int = TURN_MS

static func is_integer(value: Variant, low: int, high: int) -> bool:
    if typeof(value) not in [TYPE_INT, TYPE_FLOAT]:
        return false
    var n: float = float(value)
    return is_finite(n) and n == floor(n) and n >= low and n <= high

static func normalize_command(value: Variant) -> Dictionary:
    return Core.normalize_command(value)

func configure(seed_value: int, room_secret: String, now: int) -> void:
    game.start(seed_value)
    secret = room_secret
    guest_identity = ""
    guest_connected = false
    phase = "waiting"
    revision = 1
    next_sequence = [1, 1]
    receipts = [{}, {}]
    last_now = now
    turn_deadline = now + TURN_MS
    match_deadline = now + MATCH_MS
    reconnect_deadline = 0
    paused_remaining = TURN_MS

func connect_guest(room_secret: String, identity: String, now: int) -> Dictionary:
    tick(now)
    if secret.length() < 32 or identity.length() < 32 or identity.length() > 128:
        return {"ok": false, "error": "unauthorized"}
    if not Crypto.new().constant_time_compare(secret.to_utf8_buffer(), room_secret.to_utf8_buffer()):
        return {"ok": false, "error": "unauthorized"}
    if guest_connected:
        return {"ok": false, "error": "room_full"}
    if not guest_identity.is_empty() and identity != guest_identity:
        return {"ok": false, "error": "different_player"}
    if phase == "finished":
        return {"ok": false, "error": "finished"}
    var first_join: bool = guest_identity.is_empty()
    guest_identity = identity
    guest_connected = true
    reconnect_deadline = 0
    phase = "playing"
    if first_join:
        match_deadline = last_now + MATCH_MS
        turn_deadline = last_now + TURN_MS
    elif int(game.state.active) == 1:
        turn_deadline = last_now + maxi(1, paused_remaining)
    revision += 1
    return {"ok": true, "resumed": not first_join}

func disconnect_guest(now: int) -> void:
    tick(now)
    if not guest_connected:
        return
    guest_connected = false
    if phase != "finished" and not guest_identity.is_empty():
        reconnect_deadline = last_now + RECONNECT_MS
        paused_remaining = maxi(1, turn_deadline - last_now)
        phase = "reconnecting"
    revision += 1

func resign(player: int, now: int) -> void:
    tick(now)
    if player not in [0, 1] or phase == "finished":
        return
    game.state.winner = 1 - player
    game.state.reason = "resigned"
    phase = "finished"
    revision += 1

func tick(now: int) -> void:
    last_now = maxi(last_now, now)
    if phase == "finished":
        return
    if last_now >= match_deadline:
        game.end_on_time_limit()
        phase = "finished"
        revision += 1
        return
    if phase == "waiting":
        return
    if not guest_connected and reconnect_deadline > 0 and last_now >= reconnect_deadline:
        game.state.winner = 0
        game.state.reason = "disconnect"
        phase = "finished"
        revision += 1
        return
    for i in range(6):
        if game.state.winner != -1 or last_now < turn_deadline:
            break
        if int(game.state.active) == 1 and not guest_connected:
            break
        game.timeout(int(game.state.active))
        turn_deadline += TURN_MS
        paused_remaining = TURN_MS
        revision += 1
    if game.state.winner != -1:
        phase = "finished"

func act(player: int, sequence: Variant, value: Variant, now: int) -> Dictionary:
    tick(now)
    if player not in [0, 1]:
        return {"ok": false, "error": "wrong_player"}
    if not is_integer(sequence, 1, 1000000):
        return {"ok": false, "error": "invalid_sequence"}
    var parsed: Dictionary = normalize_command(value)
    if not parsed.ok:
        return parsed
    var command: Dictionary = parsed.command
    var seq: int = int(sequence)
    var signature: String = JSON.stringify(command).sha256_text()
    if receipts[player].has(seq):
        var old: Dictionary = receipts[player][seq]
        if old.signature != signature:
            return {"ok": false, "error": "duplicate_conflict"}
        return old.response.duplicate(true)
    if seq != next_sequence[player]:
        return {"ok": false, "error": "out_of_order", "next_sequence": next_sequence[player]}
    if phase == "waiting" or (player == 1 and not guest_connected):
        return {"ok": false, "error": "not_connected"}
    if phase == "finished":
        return {"ok": false, "error": "finished"}
    var previous_turn: int = int(game.state.turn)
    var response: Dictionary = game.apply(player, command)
    next_sequence[player] += 1
    revision += 1
    response.seq = seq
    response.revision = revision
    receipts[player][seq] = {"signature": signature, "response": response.duplicate(true)}
    if receipts[player].size() > 64:
        receipts[player].erase(seq - 64)
    if response.ok and int(game.state.turn) != previous_turn:
        turn_deadline = last_now + TURN_MS
        paused_remaining = TURN_MS
    if game.state.winner != -1:
        phase = "finished"
    return response

func view_for(player: int) -> Dictionary:
    var result: Dictionary = MatchView.for_player(game, player)
    if result.is_empty():
        return result
    result.merge({"v": VERSION, "rules": RULES, "revision": revision, "phase": phase,
        "next_sequence": next_sequence[player], "peer_connected": guest_connected,
        "turn_remaining_ms": maxi(0, turn_deadline - last_now),
        "reconnect_remaining_ms": maxi(0, reconnect_deadline - last_now)}, true)
    if phase == "waiting" or (player == 1 and not guest_connected):
        result.legal = []
    return result
