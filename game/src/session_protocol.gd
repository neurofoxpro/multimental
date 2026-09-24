class_name SessionProtocol
extends RefCounted
const Core = preload("res://src/match_core.gd")
const PROTOCOL: int = 1
var game = Core.new()
var token: String
var next_sequence: int = 1
var cache: Dictionary = {}
var connected: bool = false
func _init(secret: String = "") -> void:
    token = secret
    game.start(42)
    if int(game.state.active) == 1:
        game.apply(1, game.choose_ai())
func view() -> Dictionary:
    var me: Dictionary = game.state.players[0]
    var other: Dictionary = game.state.players[1]
    return {"board": game.state.board.duplicate(true), "hand": me.hand.duplicate(), "coins": me.coins, "deck_count": me.deck.size(), "opponent_hand_count": other.hand.size(), "opponent_deck_count": other.deck.size(), "active": game.state.active, "turn": game.state.turn, "winner": game.state.winner, "legal": game.legal(0)}
func receive(message: Variant) -> Dictionary:
    if not message is Dictionary:
        return {"ok": false, "error": "invalid_message"}
    var m: Dictionary = message
    if int(m.get("v", -1)) != PROTOCOL:
        return {"ok": false, "error": "incompatible_protocol"}
    if str(m.get("token", "")) != token or token.length() < 16:
        return {"ok": false, "error": "unauthorized"}
    var op: String = str(m.get("op", ""))
    if op == "hello":
        connected = true
        return {"ok": true, "protocol": PROTOCOL, "next_sequence": next_sequence, "view": view()}
    if not connected:
        return {"ok": false, "error": "handshake_required"}
    if op == "sync":
        return {"ok": true, "next_sequence": next_sequence, "view": view()}
    if op != "command" or not m.get("command") is Dictionary:
        return {"ok": false, "error": "invalid_operation"}
    var sequence: int = int(m.get("seq", -1))
    var signature: String = JSON.stringify(m.command).sha256_text()
    if cache.has(sequence):
        if cache[sequence].signature != signature:
            return {"ok": false, "error": "duplicate_conflict"}
        return cache[sequence].response.duplicate(true)
    if sequence != next_sequence:
        return {"ok": false, "error": "out_of_order", "next_sequence": next_sequence}
    var result: Dictionary = game.apply(0, m.command)
    if result.ok and game.state.winner == -1 and game.state.active == 1:
        game.apply(1, game.choose_ai())
    next_sequence += 1
    var response: Dictionary = {"ok": result.ok, "error": result.get("error", ""), "seq": sequence, "next_sequence": next_sequence, "view": view()}
    cache[sequence] = {"signature": signature, "response": response.duplicate(true)}
    if cache.size() > 32:
        cache.erase(sequence - 32)
    return response
