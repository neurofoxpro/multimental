class_name OnlineWss
extends RefCounted
## Bounded reliable WSS packet transport. Request semantics live in OnlineProtocol/OnlineService.
const Protocol = preload("res://src/net/online_protocol.gd")
const MAX_PACKETS_PER_POLL: int = 16
var peer: WebSocketMultiplayerPeer

func _fresh() -> void:
    peer = WebSocketMultiplayerPeer.new()
    peer.supported_protocols = PackedStringArray([Protocol.SUBPROTOCOL])
    peer.handshake_timeout = 3.0
    peer.inbound_buffer_size = Protocol.MAX_PACKET
    peer.outbound_buffer_size = Protocol.MAX_PACKET
    peer.max_queued_packets = 64
    peer.transfer_mode = MultiplayerPeer.TRANSFER_MODE_RELIABLE

func listen(port: int, tls: TLSOptions, bind: String = "*") -> Error:
    if port < 1024 or port > 65535 or tls == null or bind.length() > 255:
        return ERR_INVALID_PARAMETER
    _fresh()
    return peer.create_server(port,bind,tls)

func connect_to(url: String, tls: TLSOptions) -> Error:
    if tls == null or not url.begins_with("wss://") or url.length() > 2048:
        return ERR_INVALID_PARAMETER
    _fresh()
    return peer.create_client(url,tls)

func poll() -> Array[Dictionary]:
    if peer == null:
        return []
    peer.poll()
    var count: int = peer.get_available_packet_count()
    if count > MAX_PACKETS_PER_POLL:
        return [{"ok":false,"error":"packet_queue_limit","peer":peer.get_packet_peer()}]
    var rows: Array[Dictionary] = []
    for i in range(count):
        var sender: int = peer.get_packet_peer()
        var decoded: Dictionary = Protocol.decode(peer.get_packet())
        rows.append({"ok":decoded.ok,"error":decoded.get("error",""),"peer":sender,"message":decoded.get("message",{})})
    return rows

func send(target: int, value: Dictionary) -> Error:
    if peer == null or target < 1:
        return ERR_INVALID_PARAMETER
    var bytes: PackedByteArray = Protocol.encode(value)
    if bytes.is_empty():
        return ERR_INVALID_DATA
    peer.set_target_peer(target)
    return peer.put_packet(bytes)

func close() -> void:
    if peer != null:
        peer.close()
    peer = null
