class_name OnlineServer
extends Node
## Headless WSS adapter. OnlineService owns rooms; RoomRules/MatchCore remain the only game authority.
const Service = preload("res://src/net/online_service.gd")
const Wire = preload("res://src/net/online_wss.gd")
var service
var wire
var running: bool = false

func _init(config: Dictionary = {}) -> void:
    service = Service.new(config)
    wire = Wire.new()

func _now() -> int:
    return int(Time.get_unix_time_from_system() * 1000.0)

func listen(port: int, tls: TLSOptions, bind: String = "*") -> Error:
    if running:
        return ERR_ALREADY_IN_USE
    var error: Error = wire.listen(port,tls,bind)
    if error != OK:
        return error
    wire.peer.peer_disconnected.connect(_peer_disconnected)
    running = true
    return OK

func _peer_disconnected(id: int) -> void:
    var room: String = service.detach_peer(id,_now())
    if not room.is_empty():
        _publish(room,id)

func _publish(room: String, except_peer: int = -1) -> void:
    for item in service.state_messages(room,except_peer):
        wire.send(int(item.peer),item.message)

func _process(_delta: float) -> void:
    if not running:
        return
    var now: int = _now()
    for row in wire.poll():
        var peer_id: int = int(row.get("peer",-1))
        if not row.get("ok",false):
            if peer_id > 1:
                wire.send(peer_id,{"ok":false,"kind":"error","error":row.get("error","protocol")})
            continue
        var message: Dictionary = row.message
        var response: Dictionary = service.request(peer_id,message,now)
        wire.send(peer_id,response)
        if response.get("ok",false) and response.has("room") and message.kind in ["join","resume","command","leave"]:
            _publish(str(response.room),peer_id)
    service.cleanup(now)

func stop() -> void:
    running = false
    wire.close()
