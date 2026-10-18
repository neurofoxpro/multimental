extends SceneTree
const Rules = preload("res://src/net/room_rules.gd")
const Deck = preload("res://src/deck_rules.gd")
const Session = preload("res://src/net/lan_session.gd")
class Mailbox:
    extends RefCounted
    var sent: Array = []
    func queue(value: Dictionary) -> void:
        sent.append(value.duplicate(true))
var checks: int = 0
var failures: int = 0
func check(value: bool, text: String) -> void:
    checks += 1
    if not value:
        failures += 1
        printerr("PRODUCTION_TEST_FAIL: " + text)
func cards(start: int) -> Array[int]:
    var result: Array[int] = []
    for id in range(start, start + 15):
        result.append(id)
    return result
func _initialize() -> void:
    var token: String = "a".repeat(64)
    var identity: String = "b".repeat(64)
    var room = Rules.new()
    var left: Array[int] = cards(0)
    var right: Array[int] = cards(15)
    check(room.configure(42, token, 1000, left).ok, "custom host deck accepted")
    left[0] = 29
    check(room.host_deck[0] == 0, "host input copied")
    var before: String = room.game.digest()
    check(not room.configure(99, token, 1000, [99]).ok and room.game.digest() == before, "invalid host leaves old game intact")
    check(not room.connect_guest(token, identity, 1000, [99]).ok and room.guest_identity.is_empty(), "invalid guest before starting")
    check(not room.connect_guest("x".repeat(64), identity, 1000, right).ok, "authentication still required")
    check(room.connect_guest(token, identity, 1001, right).ok, "custom guest accepted")
    right[0] = 0
    check(room.game.initial_decks == [cards(0), cards(15)], "both actual decks locked independently")
    var chosen = room.game.choose_ai()
    var player: int = room.game.state.active
    check(room.act(player, 1, chosen, 1002).ok, "real selected-deck action")
    room.disconnect_guest(1003)
    before = room.game.digest()
    var altered: Array[int] = cards(15)
    altered.reverse()
    check(room.connect_guest(token, identity, 1003, altered).error == "deck_changed", "reconnect cannot reorder composition")
    check(not room.guest_connected and room.game.digest() == before, "rejected replacement does not restart game")
    check(room.connect_guest(token, identity, 1003, cards(15)).resumed, "same deck reconnects")
    check(room.game.digest() == before, "valid reconnect preserves exact game")
    for side in [0, 1]:
        var view: Dictionary = room.view_for(side)
        for forbidden in ["players", "seed", "initial_decks", "decks", "deck", "host_deck", "guest_deck"]:
            check(not view.has(forbidden), "private projection: " + forbidden)
    for step in range(160):
        if room.game.state.winner != -1:
            break
        player = room.game.state.active
        check(room.act(player, room.next_sequence[player], room.game.choose_ai(), 1004 + step).ok, "selected-deck turn")
    check(room.game.state.winner != -1, "custom decks reach a result")
    var session = Session.new()
    session.authority.configure(42, token, session._now(), cards(0))
    var peer: Dictionary = {"authenticated": false, "channel": Mailbox.new()}
    var hello: Dictionary = {"kind": "hello", "v": Rules.VERSION, "rules": Rules.RULES, "token": token, "identity": identity, "deck_policy": Deck.POLICY, "deck": cards(15)}
    for mode in ["old_version", "no_deck", "null_deck", "bad_policy", "oversized", "unknown_card", "too_many_copies", "extra_seed"]:
        var bad: Dictionary = hello.duplicate(true)
        match mode:
            "old_version": bad.v = 2
            "no_deck": bad.erase("deck")
            "null_deck": bad.deck = null
            "bad_policy": bad.deck_policy = "unknown"
            "oversized": bad.deck.append(0)
            "unknown_card": bad.deck[0] = 1000
            "too_many_copies": bad.deck.fill(0)
            "extra_seed": bad.seed = 123
        check(not session._host_message(peer, bad), "reject malformed hello " + mode)
        check(not peer.authenticated and session.authority.guest_identity == "", "denied hello does not claim seat")
    check(session._host_message(peer, hello), "validated hello reaches authority")
    check(session.authority.game.initial_decks == [cards(0), cards(15)], "hello deck is used by real core")
    check(not peer.channel.sent.is_empty() and not peer.channel.sent[0].view.has("deck"), "reply contains no hidden list")
    session.session_deck.assign(cards(15))
    session.invite_data = {"token": token}
    session.identity = identity
    var outgoing: Dictionary = session._hello()
    outgoing.deck[0] = 0
    check(session.session_deck[0] == 15, "hello returns copied deck")
    session.free()
    print("MULTIMENTAL_NETWORK_DECKS_PASS checks=" + str(checks)) if failures == 0 else print("NETWORK_DECKS_FAILED")
    quit(0 if failures == 0 else 1)
