class_name JsonChannel
extends RefCounted
const MAX_FRAME: int = 32768
const MAX_PENDING: int = 131072
var incoming := PackedByteArray()
var outgoing := PackedByteArray()
var messages: Array[Dictionary] = []
var failed: bool = false
func queue(value: Dictionary) -> void:
    if failed:
        return
    var body: PackedByteArray = JSON.stringify(value).to_utf8_buffer()
    if body.size() > MAX_FRAME or outgoing.size() + body.size() + 1 > MAX_PENDING:
        failed = true
        return
    outgoing.append_array(body)
    outgoing.append(10)
func consume(data: PackedByteArray) -> void:
    if failed:
        return
    incoming.append_array(data)
    if incoming.size() > MAX_PENDING:
        failed = true
        return
    var newline: int = incoming.find(10)
    while newline >= 0:
        if newline > MAX_FRAME or messages.size() >= 32:
            failed = true
            return
        var raw: PackedByteArray = incoming.slice(0, newline)
        incoming = incoming.slice(newline + 1)
        var text: String = raw.get_string_from_utf8()
        var parser := JSON.new()
        if text.to_utf8_buffer() != raw or parser.parse(text) != OK or not parser.data is Dictionary:
            failed = true
            return
        messages.append(parser.data)
        newline = incoming.find(10)
    if incoming.size() > MAX_FRAME:
        failed = true
func poll(stream: StreamPeer) -> void:
    if failed:
        return
    if not outgoing.is_empty():
        var sent: Array = stream.put_partial_data(outgoing)
        if sent[0] not in [OK, ERR_BUSY]:
            failed = true
            return
        if int(sent[1]) > 0:
            outgoing = outgoing.slice(int(sent[1]))
    var available: int = stream.get_available_bytes()
    if available > 0:
        var data: Array = stream.get_partial_data(mini(available, 16384))
        if data[0] not in [OK, ERR_BUSY]:
            failed = true
            return
        consume(data[1])
func take() -> Array[Dictionary]:
    var result: Array[Dictionary] = messages
    messages = []
    return result
