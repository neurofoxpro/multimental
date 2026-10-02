class_name BluetoothChannel
extends RefCounted
## Secure Android RFCOMM only. Pairing consent remains with the operating system.
const SERVICE: String = "81c6ade9-42f5-4e26-82de-c9c4a2e7ab91"
var thread: Thread
var mutex := Mutex.new()
var outgoing: Array[String] = []
var incoming: Array[Dictionary] = []
var status: String = "idle"
var detail: String = ""
var stopping: bool = false
var socket: Object
var listener: Object

static func available() -> Dictionary:
    if not OS.has_feature("android") or not Engine.has_singleton("JavaClassWrapper"):
        return {"ok": false, "error": "android_bluetooth_required"}
    if not OS.get_granted_permissions().has("android.permission.BLUETOOTH_CONNECT"):
        return {"ok": false, "error": "bluetooth_permission_required"}
    var jw: Object = Engine.get_singleton("JavaClassWrapper")
    var adapter: Object = jw.wrap("android.bluetooth.BluetoothAdapter").getDefaultAdapter()
    if adapter == null or not adapter.isEnabled():
        return {"ok": false, "error": "bluetooth_disabled"}
    if jw.get_exception() != null:
        return {"ok": false, "error": "bluetooth_permission_required"}
    return {"ok": true}

static func bonded() -> Array[Dictionary]:
    var result: Array[Dictionary] = []
    if not available().ok:
        return result
    var jw: Object = Engine.get_singleton("JavaClassWrapper")
    var adapter: Object = jw.wrap("android.bluetooth.BluetoothAdapter").getDefaultAdapter()
    var iterator: Object = adapter.getBondedDevices().iterator()
    while iterator.hasNext() and result.size() < 32:
        var device: Object = iterator.next()
        result.append({"name": str(device.getName()), "address": str(device.getAddress())})
    if jw.get_exception() != null:
        result.clear()
    return result

func start(host: bool, address: String = "") -> Dictionary:
    if not host:
        var expression := RegEx.new()
        expression.compile("^(?:[A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}$")
        if expression.search(address) == null:
            return {"ok": false, "error": "invalid_bluetooth_address"}
    var check: Dictionary = available()
    if not check.ok:
        return check
    if thread != null:
        return {"ok": false, "error": "already_running"}
    stopping = false
    status = "connecting"
    thread = Thread.new()
    thread.start(_worker.bind(host, address))
    return {"ok": true}

func queue(message: Dictionary) -> void:
    var text: String = JSON.stringify(message)
    mutex.lock()
    if text.to_utf8_buffer().size() <= 32768 and outgoing.size() < 32:
        outgoing.append(text)
    else:
        stopping = true
        detail = "message_limit"
    mutex.unlock()

func take() -> Array[Dictionary]:
    mutex.lock()
    var messages: Array[Dictionary] = incoming
    incoming = []
    mutex.unlock()
    return messages

func inspect() -> Dictionary:
    mutex.lock()
    var result: Dictionary = {"status": status, "detail": detail}
    mutex.unlock()
    return result

func _set_status(value: String, reason: String = "") -> void:
    mutex.lock()
    status = value
    detail = reason
    mutex.unlock()

func _should_stop() -> bool:
    mutex.lock()
    var result: bool = stopping
    mutex.unlock()
    return result

func close() -> void:
    mutex.lock()
    stopping = true
    var active_socket: Object = socket
    var active_listener: Object = listener
    mutex.unlock()
    # Android BluetoothSocket.close aborts blocking connect/read/accept.
    if active_socket != null:
        active_socket.close()
    if active_listener != null:
        active_listener.close()
    if thread != null and thread.is_started():
        thread.wait_to_finish()
    thread = null

func _worker(host: bool, address: String) -> void:
    var jw: Object = Engine.get_singleton("JavaClassWrapper")
    var adapter: Object = jw.wrap("android.bluetooth.BluetoothAdapter").getDefaultAdapter()
    var uuid: Object = jw.wrap("java.util.UUID").fromString(SERVICE)
    var peer: Object
    if host:
        var server: Object = adapter.listenUsingRfcommWithServiceRecord("Multimental", uuid)
        if jw.get_exception() != null or server == null:
            _set_status("failed", "secure_listen_failed")
            return
        mutex.lock()
        listener = server
        mutex.unlock()
        if _should_stop():
            server.close()
            _set_status("closed")
            return
        _set_status("listening")
        peer = server.accept(300000)
        var accept_error: Object = jw.get_exception()
        server.close()
        mutex.lock()
        listener = null
        mutex.unlock()
        if accept_error != null or peer == null:
            _set_status("closed" if _should_stop() else "failed", "pairing_or_accept_failed")
            return
    else:
        var device: Object = adapter.getRemoteDevice(address)
        if device == null or int(device.getBondState()) != 12:
            _set_status("failed", "pair_device_in_android_settings")
            return
        peer = device.createRfcommSocketToServiceRecord(uuid)
        if jw.get_exception() != null or peer == null:
            _set_status("failed", "secure_socket_failed")
            return
        mutex.lock()
        socket = peer
        mutex.unlock()
        if _should_stop():
            peer.close()
            _set_status("closed")
            return
        # Runtime dispatch lets JavaObject resolve the zero-argument Java method
        # after the unrelated Godot Object.connect(signal, callable) is rejected.
        peer.call("connect")
        if jw.get_exception() != null:
            peer.close()
            _set_status("failed", "secure_connect_failed")
            return
    mutex.lock()
    socket = peer
    mutex.unlock()
    if _should_stop():
        peer.close()
        _set_status("closed")
        return
    var input: Object = peer.getInputStream()
    var output: Object = peer.getOutputStream()
    var writer: Object = jw.wrap("java.io.OutputStreamWriter").OutputStreamWriter(output, "UTF-8")
    if jw.get_exception() != null or writer == null:
        peer.close()
        _set_status("failed", "stream_failed")
        return
    if int(peer.getRemoteDevice().getBondState()) != 12 or jw.get_exception() != null:
        peer.close()
        _set_status("failed", "authenticated_peer_required")
        return
    _set_status("connected")
    var bytes := PackedByteArray()
    var last_activity: int = Time.get_ticks_msec()
    while not _should_stop() and Time.get_ticks_msec() - last_activity < 15000:
        mutex.lock()
        var send_now: Array[String] = outgoing
        outgoing = []
        mutex.unlock()
        for text in send_now:
            var line: String = text + "\n"
            writer.write(line, 0, int(line.to_utf16_buffer().size() / 2))
            writer.flush()
            if jw.get_exception() != null:
                peer.close()
                _set_status("failed", "write_failed")
                return
        var available_bytes: int = int(input.available())
        if jw.get_exception() != null:
            break
        for i in range(mini(available_bytes, 8192)):
            var byte: int = int(input.read())
            if byte < 0 or jw.get_exception() != null:
                peer.close()
                _set_status("closed", "read_failed")
                return
            last_activity = Time.get_ticks_msec()
            if byte == 10:
                var text: String = bytes.get_string_from_utf8()
                var parser := JSON.new()
                if text.to_utf8_buffer() != bytes or parser.parse(text) != OK or not parser.data is Dictionary:
                    peer.close()
                    _set_status("failed", "invalid_message")
                    return
                mutex.lock()
                if incoming.size() >= 32:
                    stopping = true
                else:
                    incoming.append(parser.data)
                mutex.unlock()
                bytes = PackedByteArray()
            else:
                bytes.append(byte)
                if bytes.size() > 32768:
                    peer.close()
                    _set_status("failed", "message_limit")
                    return
        OS.delay_msec(10)
    peer.close()
    _set_status("closed")
