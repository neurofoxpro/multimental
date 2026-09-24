extends Node
## Test-only lab. Activated only by a one-use private file in a debug build.
## Production multiplayer UI/discovery is deliberately not implied by this lab.
const Protocol = preload("res://src/session_protocol.gd")
var ui: Control
var worker: Thread
var report: Dictionary = {}
var finished: bool = false
func _ready() -> void:
    if not OS.is_debug_build() or not FileAccess.file_exists("user://automation-request.json"):
        queue_free()
        return
    var data: Variant = JSON.parse_string(FileAccess.get_file_as_string("user://automation-request.json"))
    DirAccess.remove_absolute("user://automation-request.json")
    if not data is Dictionary or str(data.get("nonce", "")).length() < 24:
        queue_free()
        return
    report = {"nonce": data.nonce, "mode": data.get("mode", "ui"), "status": "running", "version": BuildInfo.VERSION}
    _save()
    match str(data.get("mode", "ui")):
        "ui":
            call_deferred("_ui")
        "tcp-server":
            worker = Thread.new()
            worker.start(_tcp_server.bind(data))
        "bluetooth-server":
            worker = Thread.new()
            worker.start(_bluetooth_server.bind(data))
        "tcp-client":
            worker = Thread.new()
            worker.start(_tcp_client.bind(data))
        _:
            _done({"status": "failed", "error": "unsupported_mode"})
func _save() -> void:
    var file := FileAccess.open("user://automation-result.json", FileAccess.WRITE)
    if file != null:
        file.store_string(JSON.stringify(report))
func _stage(values: Dictionary) -> void:
    report.merge(values, true)
    _save()
func _done(values: Dictionary) -> void:
    if worker != null and worker.is_started():
        worker.wait_to_finish()
    report.merge(values, true)
    finished = true
    _save()
    print("MULTIMENTAL_AUTOMATION_DONE " + str(report.status))
func _screen_center(control: Control) -> Array:
    var point: Vector2 = get_viewport().get_screen_transform() * control.get_global_transform_with_canvas() * (control.size * 0.5)
    return [int(round(point.x)), int(round(point.y))]
func _ui() -> void:
    ui.set_process(false)
    var previous_language: String = ui.language
    ui.language = "ru"
    ui.start_match()
    ui.game.start(42)
    if int(ui.game.state.active) == 1:
        ui.game.apply(1, ui.game.choose_ai())
    ui.refresh()
    await get_tree().process_frame
    await get_tree().process_frame
    var checks: Array[Dictionary] = [{"name": "board", "ok": ui.board_buttons.size() == 9}]
    var chosen: Dictionary = {}
    for command in ui.game.legal(0):
        if command.type == "play":
            chosen = command
            break
    checks.append({"name": "playable_fixture", "ok": not chosen.is_empty()})
    var selected: bool = false
    var placed: bool = false
    if not chosen.is_empty():
        var card: Control = ui.hand_row.get_child(int(chosen.hand))
        _stage({"stage": "waiting_card_tap", "tap": _screen_center(card)})
        var end: int = Time.get_ticks_msec() + 25000
        while Time.get_ticks_msec() < end and ui.selected_hand != int(chosen.hand):
            await get_tree().create_timer(0.05).timeout
        selected = ui.selected_hand == int(chosen.hand)
        if selected:
            _stage({"stage": "waiting_target_tap", "tap": _screen_center(ui.board_buttons[int(chosen.cell)])})
            end = Time.get_ticks_msec() + 25000
            while Time.get_ticks_msec() < end and ui.game.count_cells(0) != 1:
                await get_tree().create_timer(0.05).timeout
            placed = ui.game.count_cells(0) == 1
    checks.append({"name": "os_card_tap", "ok": selected})
    checks.append({"name": "os_target_tap_and_placement", "ok": placed})
    var rect: Rect2 = ui.get_viewport_rect()
    var bounds_ok: bool = true
    for button in ui.board_buttons:
        if not rect.encloses(button.get_global_rect()):
            bounds_ok = false
    checks.append({"name": "board_within_viewport", "ok": bounds_ok})
    ui.show_menu()
    checks.append({"name": "return_menu", "ok": not ui.battle})
    ui.language = previous_language
    ui.show_menu()
    ui.set_process(true)
    var all_ok: bool = true
    for check in checks:
        if not check.ok:
            all_ok = false
    _done({"status": "passed" if all_ok else "failed", "checks": checks, "viewport": [rect.size.x, rect.size.y], "input_source": "external_android_input_tap"})
func _tcp_server(data: Dictionary) -> void:
    var server := TCPServer.new()
    var error: Error = server.listen(17843, "0.0.0.0")
    if error != OK:
        call_deferred("_done", {"status": "failed", "error": "listen_failed"})
        return
    call_deferred("_stage", {"stage": "listening", "port": 17843})
    var end: int = Time.get_ticks_msec() + 90000
    var requests: int = 0
    var p = Protocol.new(str(data.nonce))
    while Time.get_ticks_msec() < end:
        if not server.is_connection_available():
            OS.delay_msec(10)
            continue
        var peer := server.take_connection()
        var buffer := PackedByteArray()
        while Time.get_ticks_msec() < end:
            peer.poll()
            if peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
                break
            var amount: int = peer.get_available_bytes()
            if amount > 0:
                var received: Array = peer.get_data(amount)
                if received[0] != OK:
                    break
                buffer.append_array(received[1])
                if buffer.size() > 16384:
                    break
                var newline: int = buffer.find(10)
                while newline >= 0:
                    var m: Variant = JSON.parse_string(buffer.slice(0, newline).get_string_from_utf8())
                    buffer = buffer.slice(newline + 1)
                    var response: Dictionary = p.receive(m)
                    peer.put_data((JSON.stringify(response) + "\n").to_utf8_buffer())
                    requests += 1
                    newline = buffer.find(10)
            OS.delay_msec(10)
        peer.disconnect_from_host()
        if requests >= 5:
            break
    server.stop()
    call_deferred("_done", {"status": "passed" if requests >= 5 else "failed", "requests": requests, "transport": "tcp", "scope": "diagnostic_authoritative_session"})
func _bluetooth_server(data: Dictionary) -> void:
    if not Engine.has_singleton("JavaClassWrapper"):
        call_deferred("_done", {"status": "blocked", "error": "not_android"})
        return
    var jw: Object = Engine.get_singleton("JavaClassWrapper")
    var adapter_class: Object = jw.wrap("android.bluetooth.BluetoothAdapter")
    var adapter: Object = adapter_class.getDefaultAdapter()
    if adapter == null or not adapter.isEnabled():
        call_deferred("_done", {"status": "blocked", "error": "bluetooth_disabled"})
        return
    var uuid_class: Object = jw.wrap("java.util.UUID")
    var uuid: Object = uuid_class.fromString("7e120e58-6fbd-4e4f-80e8-5685947c9dab")
    var listener: Object = adapter.listenUsingInsecureRfcommWithServiceRecord("MultimentalLab", uuid)
    if jw.get_exception() != null or listener == null:
        call_deferred("_done", {"status": "blocked", "error": "bluetooth_permission_or_listen"})
        return
    call_deferred("_stage", {"stage": "listening", "transport": "rfcomm"})
    var socket: Object = listener.accept(45000)
    var exception: Object = jw.get_exception()
    listener.close()
    if exception != null or socket == null:
        call_deferred("_done", {"status": "failed", "error": "bluetooth_accept_timeout"})
        return
    call_deferred("_stage", {"stage": "connected"})
    var reader_class: Object = jw.wrap("java.io.InputStreamReader")
    var buffer_class: Object = jw.wrap("java.io.BufferedReader")
    var writer_class: Object = jw.wrap("java.io.OutputStreamWriter")
    call_deferred("_stage", {"stage": "classes_ready"})
    var input_stream: Object = socket.getInputStream()
    call_deferred("_stage", {"stage": "input_stream_ready"})
    var raw_reader: Object = reader_class.InputStreamReader(input_stream, "UTF-8")
    call_deferred("_stage", {"stage": "raw_reader_ready"})
    var reader: Object = buffer_class.BufferedReader(raw_reader)
    call_deferred("_stage", {"stage": "reader_ready"})
    var writer: Object = writer_class.OutputStreamWriter(socket.getOutputStream(), "UTF-8")
    call_deferred("_stage", {"stage": "streams_ready"})
    if jw.get_exception() != null or reader == null or writer == null:
        socket.close()
        call_deferred("_done", {"status": "failed", "error": "bluetooth_stream_init"})
        return
    var p = Protocol.new(str(data.nonce))
    var requests: int = 0
    var end: int = Time.get_ticks_msec() + 45000
    var failure: String = ""
    while Time.get_ticks_msec() < end and requests < 6:
        var ready: bool = bool(reader.ready())
        if jw.get_exception() != null:
            failure = "reader_ready_exception"
            break
        if not ready:
            OS.delay_msec(10)
            continue
        call_deferred("_stage", {"stage": "reading_line", "requests": requests})
        var line: Variant = reader.readLine()
        call_deferred("_stage", {"stage": "line_read", "requests": requests})
        if jw.get_exception() != null or line == null:
            failure = "reader_line_exception"
            break
        if str(line).length() > 16384:
            failure = "oversize_frame"
            break
        var response: Dictionary = p.receive(JSON.parse_string(str(line)))
        writer.write(JSON.stringify(response) + "\n")
        if jw.get_exception() != null:
            failure = "writer_exception"
            break
        writer.flush()
        if jw.get_exception() != null:
            failure = "flush_exception"
            break
        requests += 1
        call_deferred("_stage", {"stage": "exchanging", "requests": requests})
    socket.close()
    call_deferred("_done", {"status": "passed" if requests == 6 else "failed", "requests": requests, "error": failure, "transport": "rfcomm", "scope": "diagnostic_only_not_production_pairing"})
func _tcp_client(data: Dictionary) -> void:
    var peer := StreamPeerTCP.new()
    var err: Error = peer.connect_to_host(str(data.get("address", "")), 17843)
    var end: int = Time.get_ticks_msec() + 25000
    while Time.get_ticks_msec() < end:
        peer.poll()
        if peer.get_status() == StreamPeerTCP.STATUS_CONNECTED:
            break
        OS.delay_msec(10)
    if err != OK or peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
        call_deferred("_done", {"status": "failed", "error": "connect_timeout"})
        return
    var messages: Array[Dictionary] = [{"v": 1, "token": data.token, "op": "hello"}, {"v": 99, "token": data.token, "op": "hello"}, {"v": 1, "token": data.token, "op": "sync"}, {"v": 1, "token": data.token, "op": "command", "seq": 1, "command": {"type": "pass"}}, {"v": 1, "token": data.token, "op": "command", "seq": 1, "command": {"type": "pass"}}, {"v": 1, "token": data.token, "op": "sync"}]
    var replies: Array[Dictionary] = []
    var buffer: String = ""
    for m in messages:
        peer.put_data((JSON.stringify(m) + "\n").to_utf8_buffer())
        while Time.get_ticks_msec() < end and not buffer.contains("\n"):
            peer.poll()
            var count: int = peer.get_available_bytes()
            if count > 0:
                buffer += peer.get_utf8_string(count)
            OS.delay_msec(10)
        if not buffer.contains("\n"):
            break
        var line: String = buffer.get_slice("\n", 0)
        buffer = buffer.substr(line.length() + 1)
        var decoded: Variant = JSON.parse_string(line)
        if decoded is Dictionary:
            replies.append(decoded)
    peer.disconnect_from_host()
    var success: bool = replies.size() == 6 and replies[0].get("ok", false) and replies[1].get("error") == "incompatible_protocol" and replies[3] == replies[4]
    call_deferred("_done", {"status": "passed" if success else "failed", "reply_count": replies.size(), "transport": "tcp", "scope": "device_to_device_protocol"})
