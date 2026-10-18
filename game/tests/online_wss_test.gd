extends SceneTree
const Server = preload("res://src/net/online_server.gd")
const Wire = preload("res://src/net/online_wss.gd")
const Protocol = preload("res://src/net/online_protocol.gd")
const Rules = preload("res://src/net/room_rules.gd")
const View = preload("res://src/net/room_view.gd")
const PORT: int = 17846
var checks: int = 0
var failures: int = 0
var server
var left
var right
func check(value: bool, label_text: String) -> void:
    checks += 1
    if not value:
        failures += 1
        printerr("ONLINE_WSS_FAIL " + label_text)
func request(kind: String, fields: Dictionary = {}) -> Dictionary:
    var value: Dictionary = {"v":Protocol.VERSION,"rules":Rules.RULES,"kind":kind}
    value.merge(fields,true)
    return value
func receive_one(wire, milliseconds: int = 7000) -> Dictionary:
    var end: int = Time.get_ticks_msec() + milliseconds
    while Time.get_ticks_msec() < end:
        for row in wire.poll():
            if row.get("ok",false):
                return row.message
        await create_timer(0.02).timeout
    return {}
func connected(wire, milliseconds: int = 7000) -> bool:
    var end: int = Time.get_ticks_msec() + milliseconds
    while Time.get_ticks_msec() < end:
        wire.poll()
        if wire.peer.get_connection_status() == MultiplayerPeer.CONNECTION_CONNECTED:
            return true
        await create_timer(0.02).timeout
    return false
func _initialize() -> void:
    call_deferred("run_test")
func run_test() -> void:
    var crypto := Crypto.new()
    var key: CryptoKey = crypto.generate_rsa(2048)
    var cert: X509Certificate = crypto.generate_self_signed_certificate(key,"CN=localhost,O=Multimental,C=FI","20200101000000","20491231235959")
    check(key != null and cert != null,"test TLS identity")
    server = Server.new({"max_rooms":4,"rate_requests":50})
    root.add_child(server)
    check(server.listen(PORT,TLSOptions.server(key,cert),"*") == OK,"WSS server listens with TLS")
    left = Wire.new()
    right = Wire.new()
    check(left.connect_to("wss://localhost:%d" % PORT,TLSOptions.client(cert)) == OK,"first WSS client starts")
    check(await connected(left),"first WSS handshake")
    check(left.peer.get_peer(1).get_selected_protocol() == Protocol.SUBPROTOCOL,"WebSocket subprotocol negotiated")
    var host_identity: String = "a".repeat(64)
    check(left.send(1,request("create",{"identity":host_identity,"deck":range(0,15)})) == OK,"create packet sent")
    var created: Dictionary = await receive_one(left)
    check(created.get("ok",false) and created.get("kind") == "created" and View.valid(created.get("view",{})),"create response over WSS")
    var room: String = str(created.get("room",""))
    var token: String = str(created.get("token",""))
    check(room.length() >= 8 and token.length() >= 32,"opaque room capability returned only to creator")
    check(right.connect_to("wss://localhost:%d" % PORT,TLSOptions.client(cert)) == OK,"second WSS client starts")
    check(await connected(right),"second WSS handshake")
    check(right.send(1,request("join",{"room":room,"token":token,"identity":"b".repeat(64),"deck":range(15,30)})) == OK,"join packet sent")
    var joined: Dictionary = await receive_one(right)
    check(joined.get("ok",false) and joined.get("kind") == "joined" and View.valid(joined.get("view",{})),"join response over WSS")
    var host_update: Dictionary = await receive_one(left)
    check(host_update.get("kind") == "state" and host_update.get("room") == room and host_update.view.peer_connected,"join state pushed to host")
    check(left.send(1,request("ping")) == OK,"ping sent")
    var pong: Dictionary = await receive_one(left)
    check(pong.get("kind") == "pong" and pong.get("v") == Protocol.VERSION,"versioned ping over WSS")
    var insecure = Wire.new()
    check(insecure.connect_to("ws://localhost:%d" % PORT,TLSOptions.client(cert)) == ERR_INVALID_PARAMETER,"plain WS refused by adapter")
    left.close()
    right.close()
    server.stop()
    server.queue_free()
    await process_frame
    if failures == 0:
        print("MULTIMENTAL_ONLINE_WSS_PASS checks=%d tls=true subprotocol=%s authority=RoomRules" % [checks,Protocol.SUBPROTOCOL])
    quit(0 if failures == 0 else 1)
