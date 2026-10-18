extends SceneTree
const Rules = preload("res://src/net/room_rules.gd")
const Invite = preload("res://src/net/room_invite.gd")
const Channel = preload("res://src/net/json_channel.gd")
const View = preload("res://src/net/room_view.gd")
var failures: int = 0
var checks: int = 0
func check(value: bool, label_text: String) -> void:
    checks += 1
    if not value:
        failures += 1
        printerr("PRODUCTION_TEST_FAIL: " + label_text)
func _initialize() -> void:
    var secret: String = "a".repeat(64)
    var guest: String = "b".repeat(64)
    var room = Rules.new()
    room.configure(42, secret, 1000)
    check(room.phase == "waiting" and room.view_for(0).legal.is_empty(), "no play before two players")
    check(not room.connect_guest("wrong", guest, 1000).ok, "wrong room capability")
    check(room.connect_guest(secret, guest, 1000).ok, "first guest joins")
    check(not room.connect_guest(secret, guest, 1000).ok, "room has one guest only")
    for player in [0, 1]:
        var view: Dictionary = room.view_for(player)
        check(View.valid(view), "valid player view")
        check(not view.has("players") and not view.has("seed") and not view.has("deck"), "opponent hand and deck order absent")
        view.hand.clear()
        check(not room.game.state.players[player].hand.is_empty(), "view mutation cannot alter host")
    var player: int = int(room.game.state.active)
    var command: Dictionary = room.game.legal(player)[0]
    var wire_command: Dictionary = JSON.parse_string(JSON.stringify(command))
    var first: Dictionary = room.act(player, 1.0, wire_command, 1000)
    check(first.ok, "wire numbers normalized")
    var digest: String = room.game.digest()
    check(room.act(player, 1, command, 1000) == first, "same request gets same receipt")
    check(room.game.digest() == digest, "duplicate has no extra effect")
    var conflict: Dictionary = {"type": "pass"} if command.type != "pass" else {"type": "play", "hand": 0, "cell": 0, "direction": 0}
    check(room.act(player, 1, conflict, 1000).error == "duplicate_conflict", "conflicting repeat rejected")
    check(room.act(player, 100, {"type": "pass"}, 1000).error == "out_of_order", "future sequence rejected")
    check(not room.act(9, 1, {"type": "pass"}, 1000).ok, "caller cannot choose third role")
    check(not Rules.normalize_command({"type": "play", "hand": 0.5, "cell": 0, "direction": 0}).ok, "fractional index rejected")
    check(not Rules.normalize_command({"type": "pass", "player": 1}).ok, "role injection rejected")
    room.disconnect_guest(1000)
    check(room.phase == "reconnecting", "disconnect state")
    check(not room.connect_guest(secret, "c".repeat(64), 1000).ok, "invitation cannot replace an existing player")
    check(room.connect_guest(secret, guest, 1001).resumed, "original identity resumes")
    check(room.game.digest() == digest, "resync keeps game state")
    room.disconnect_guest(1001)
    room.tick(62000)
    check(room.game.state.winner == 0 and room.game.state.reason == "disconnect", "bounded reconnect grace")
    room.configure(42, secret, 0)
    room.connect_guest(secret, guest, 0)
    room.tick(30000)
    check(room.game.commands.size() == 1 and room.game.commands[0].command.type == "timeout", "host owns elapsed turn")
    room.tick(90000)
    check(room.phase == "finished" and room.game.state.reason == "timeout", "two missed own turns lose")
    room.configure(42, secret, 0)
    room.connect_guest(secret, guest, 0)
    room.tick(900000)
    check(room.phase == "finished" and room.game.state.reason == "limit", "global match cap")
    var invite: String = Invite.encode("192.168.1.2", 17844, secret, guest)
    check(Invite.decode(invite).ok, "local invitation roundtrip")
    check(not Invite.decode(Invite.encode("8.8.8.8", 17844, secret, guest)).ok, "no unintended public target")
    check(not Invite.decode(invite + "!").ok, "malformed invitation rejected")
    var channel = Channel.new()
    var frame: PackedByteArray = (JSON.stringify({"ru": "Огонь", "value": 2}) + "\n").to_utf8_buffer()
    for byte in frame:
        channel.consume(PackedByteArray([byte]))
    check(not channel.failed and channel.take()[0].ru == "Огонь", "fragmented unicode frame")
    channel.consume(("{bad}\n").to_utf8_buffer())
    check(channel.failed, "malformed JSON rejects connection")
    var huge = Channel.new()
    huge.consume("x".repeat(40000).to_utf8_buffer())
    check(huge.failed, "bounded receive memory")
    for seed_value in range(1, 51):
        room.configure(seed_value, secret, 0)
        room.connect_guest(secret, guest, 0)
        for step in range(100):
            if room.phase == "finished":
                break
            var actor: int = int(room.game.state.active)
            var action: Dictionary = room.game.choose_ai()
            check(room.act(actor, room.next_sequence[actor], JSON.parse_string(JSON.stringify(action)), step * 10).ok, "two-player legal command")
            check(View.valid(room.view_for(0)) and View.valid(room.view_for(1)), "filtered snapshots remain valid")
        if room.phase != "finished":
            room.tick(900000)
        check(room.phase == "finished", "bounded two-player session")
        check(room.view_for(0).scores[0] == room.view_for(1).scores[1], "consistent opposite perspective")
    if failures == 0:
        print("MULTIMENTAL_ROOM_PASS checks=%d simulations=50" % checks)
    quit(0 if failures == 0 else 1)
