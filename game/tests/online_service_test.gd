extends SceneTree
const Service = preload("res://src/net/online_service.gd")
const Protocol = preload("res://src/net/online_protocol.gd")
const View = preload("res://src/net/room_view.gd")
const Rules = preload("res://src/net/room_rules.gd")
var checks: int = 0
var failures: int = 0
func check(value: bool, label_text: String) -> void:
    checks += 1
    if not value:
        failures += 1
        printerr("ONLINE_SERVICE_FAIL " + label_text)
func message(kind: String, fields: Dictionary = {}) -> Dictionary:
    var result: Dictionary = {"v":Protocol.VERSION,"rules":Rules.RULES,"kind":kind}
    result.merge(fields,true)
    return result
func _initialize() -> void:
    var service = Service.new({"max_rooms":2,"rate_requests":100})
    var left: Array = range(0,15)
    var right: Array = range(15,30)
    var identity_a: String = "a".repeat(64)
    var identity_b: String = "b".repeat(64)
    var room_a: String = "a".repeat(24)
    var token_a: String = "c".repeat(64)
    var created: Dictionary = service.request(2,message("create",{"identity":identity_a,"deck":left}),0,{"room":room_a,"token":token_a,"seed":42})
    check(created.ok and created.room == room_a and created.player == 0,"create exact room")
    check(View.valid(created.view) and not created.view.has("seed") and not created.view.has("players"),"created view filtered")
    check(not JSON.stringify(created.view).contains(token_a),"capability absent from public view")
    check(service.request(3,message("join",{"room":room_a,"token":"d".repeat(64),"identity":identity_b,"deck":right}),1).error == "unauthorized","wrong token rejected")
    var joined: Dictionary = service.request(3,message("join",{"room":room_a,"token":token_a,"identity":identity_b,"deck":right}),2)
    check(joined.ok and joined.player == 1 and not joined.resumed and View.valid(joined.view),"guest joins")
    check(service.state_messages(room_a,3).size() == 1 and int(service.state_messages(room_a,3)[0].peer) == 2,"join publishes only to other member")
    var authority = service.rooms[room_a].authority
    var active: int = int(authority.game.state.active)
    var actor_peer: int = 2 if active == 0 else 3
    var action: Dictionary = authority.game.legal(active)[0]
    var first: Dictionary = service.request(actor_peer,message("command",{"room":room_a,"seq":1,"command":action}),3)
    check(first.ok and first.result.ok and View.valid(first.view),"authoritative command")
    var digest: String = authority.game.digest()
    var duplicate: Dictionary = service.request(actor_peer,message("command",{"room":room_a,"seq":1,"command":action}),4)
    check(duplicate.ok and duplicate.result == first.result and authority.game.digest() == digest,"duplicate command has one effect")
    var room_b: String = "e".repeat(24)
    var token_b: String = "f".repeat(64)
    var second: Dictionary = service.request(4,message("create",{"identity":"1".repeat(64),"deck":left}),5,{"room":room_b,"token":token_b,"seed":99})
    check(second.ok and service.rooms[room_b].authority.game.digest() != digest,"second room has independent state")
    var third: Dictionary = service.request(5,message("create",{"identity":"2".repeat(64),"deck":left}),6,{"room":"3".repeat(24),"token":"4".repeat(64),"seed":7})
    check(not third.ok and third.error == "room_limit","room resource cap")
    var disconnected: String = service.detach_peer(3,10)
    check(disconnected == room_a and not service.rooms[room_a].authority.guest_connected,"guest disconnect recorded")
    var host_state: Dictionary = service.request(2,message("sync",{"room":room_a}),11)
    check(host_state.ok and not host_state.view.peer_connected and host_state.view.phase == "reconnecting","host sees reconnect state")
    var resumed: Dictionary = service.request(6,message("resume",{"room":room_a,"token":token_a,"identity":identity_b}),12)
    check(resumed.ok and resumed.player == 1 and resumed.view.peer_connected,"same guest identity resumes")
    service.detach_peer(2,13)
    var guest_state: Dictionary = service.request(6,message("sync",{"room":room_a}),14)
    check(guest_state.ok and not guest_state.view.peer_connected,"guest sees host disconnected")
    var host_resume: Dictionary = service.request(7,message("resume",{"room":room_a,"token":token_a,"identity":identity_a}),15)
    check(host_resume.ok and host_resume.player == 0,"same host identity reattaches")
    check(not service.request(8,message("resume",{"room":room_a,"token":token_a,"identity":"9".repeat(64)}),16).ok,"foreign identity cannot resume")
    var limited = Service.new({"rate_requests":2,"rate_window_ms":1000})
    check(limited.request(20,message("ping"),0).ok and limited.request(20,message("ping"),1).ok,"rate window permits bounded calls")
    check(limited.request(20,message("ping"),2).error == "rate_limited","rate limit enforced")
    check(limited.request(20,message("ping"),1001).ok,"rate window resets")
    var waiting = Service.new({"waiting_ttl_ms":1000})
    waiting.request(30,message("create",{"identity":identity_a,"deck":left}),0,{"room":"5".repeat(24),"token":"6".repeat(64),"seed":8})
    waiting.cleanup(1000)
    check(waiting.rooms.is_empty(),"waiting room TTL")
    var encoded: PackedByteArray = Protocol.encode(message("ping"))
    check(not encoded.is_empty() and Protocol.decode(encoded).ok,"versioned packet roundtrip")
    check(not Protocol.decode("x".repeat(Protocol.MAX_PACKET+1).to_utf8_buffer()).ok,"oversized packet rejected")
    check(not Protocol.validate({"v":Protocol.VERSION,"rules":Rules.RULES,"kind":"admin"}).ok,"unknown command kind rejected")
    if failures == 0:
        print("MULTIMENTAL_ONLINE_SERVICE_PASS checks=%d rooms_isolated=true rules_reused=true" % checks)
    quit(0 if failures == 0 else 1)
