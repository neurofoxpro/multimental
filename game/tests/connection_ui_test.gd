extends SceneTree
const Session = preload("res://src/net/lan_session.gd")
var checks: int = 0
var failures: int = 0
class NoSocketSession extends Session:
    var attempts: int = 0
    func _process(_delta: float) -> void:
        pass
    func join_room(text: String, chosen: Variant = null) -> Dictionary:
        attempts += 1
        invitation = text
        session_deck.assign(chosen)
        running = false
        connection_status = "connection_failed"
        return {"ok": true}
    func host_room(_address: String = "", _port: int = PORT, _seed: int = 0, chosen: Variant = null) -> Dictionary:
        session_deck.assign(chosen)
        running = true
        invitation = "fixture-invitation-not-a-real-room"
        connection_status = "waiting_guest"
        return {"ok": true, "invitation": invitation}
    func leave() -> void:
        stop()
func check(value: bool, title: String) -> void:
    checks += 1
    if not value:
        failures += 1
        print("CONNECTION_UI_FAIL " + title)
func settle() -> void:
    for frame in range(5):
        await process_frame
func _initialize() -> void:
    call_deferred("run_test")
func run_test() -> void:
    root.gui_embed_subwindows = true
    var directory: String = "user://profile-tests/connection-ui-" + Crypto.new().generate_random_bytes(12).hex_encode()
    var ui = load("res://src/main.tscn").instantiate()
    ui.profile_directory = directory
    ui.profile_legacy_settings = ""
    root.add_child(ui)
    ui.set_process(false)
    check(ui.ensure_collection(), "isolated collection available")
    var initial: Dictionary = ui.profile.state()
    var invite: String = RoomInvite.encode("127.0.0.1", 17844, "a".repeat(64), "b".repeat(64))
    for locale in ["ru", "en"]:
        ui.language = locale
        for viewport in [Vector2i(720,1280), Vector2i(1280,720), Vector2i(640,480), Vector2i(390,844)]:
            root.content_scale_size = viewport
            root.size = viewport
            ui.show_lan_menu()
            await settle()
            var page: ScrollContainer = ui.root.get_parent()
            check(ui.get_viewport_rect().size == Vector2(viewport), "actual connection viewport")
            check(not ui.lan.running and ui.profile.state() == initial, "entry doesn't start connection or mutate profile")
            ui.invite_input.text = ""
            ui.remember_invitation()
            check(ui.connection_join_button.disabled, "empty invitation cannot be joined")
            for id in ["NetworkDeck", "CreateRoom", "RoomInvitation", "PasteInvite", "JoinRoom", "NetworkBack"]:
                var action: Control = ui.find_child(id, true, false)
                check(action != null, "stable connection action ID " + id)
                page.ensure_control_visible(action)
                await settle()
                check(ui.get_viewport_rect().encloses(action.get_global_rect()), "connection action reachable " + id + " " + str(viewport))
            ui.invite_input.text = "not-an-invitation"
            ui.remember_invitation()
            var result: Dictionary = ui.join_lan_room(ui.invite_input.text)
            await settle()
            check(not result.ok and not ui.lan.running and not ui.online, "malformed invitation never activates a transport")
            check(ui.lobby_status.text == ui.network_error("invalid_invite"), "malformed input explained")
            check(ui.get_viewport_rect().encloses(ui.lobby_status.get_global_rect()), "error scrolls into view")
            ui.invite_input.text = invite
            ui.remember_invitation()
            check(not ui.connection_join_button.disabled, "nonempty bounded invite enables join")
            ui.invite_input.text = "x".repeat(2049)
            ui.remember_invitation()
            check(ui.connection_join_button.disabled and ui.invitation_drafts.lan == invite, "oversized pasted input doesn't poison previous draft")
            check(not ui.join_lan_room(ui.invite_input.text).ok and not ui.lan.running, "oversized direct call also rejected")
            ui.invite_input.text = invite
            ui.remember_invitation()
            ui.edit_network_deck()
            await settle()
            var editor = ui.find_child("CollectionScreen", true, false)
            check(editor != null and editor.back_button.text == ui.t("К ПОДКЛЮЧЕНИЮ", "BACK TO CONNECTION"), "contextual return from deck editor")
            editor.request_leave()
            await settle()
            check(ui.network_page and ui.invite_input.text == invite and ui.profile.state() == initial, "deck editing navigation preserves private in-memory invite")
            check(not ui.profile.state().has("invitation"), "invite not written to profile")
            ui.show_menu()
    ui.show_lan_menu()
    ui.join_lan_room("invalid-before-navigation")
    ui.show_menu()
    await settle()
    check(not ui.network_page and not ui.battle, "deferred error reveal is safe after immediate navigation")
    for title in ["Очень длинная сохранённая колода для тактики", "A very long saved deck name for tactical matches"]:
        var selected: String = str(ui.profile.state().collection.selected)
        check(ui.profile.commit({"kind":"deck_save", "id":selected, "name":title, "cards":ui.profile.state().decks[selected]}), "long named deck fixture")
        ui.show_menu()
        await settle()
        check(title in ui.find_child("SelectedDeckSummary", true, false).text, "full selected deck name retained in menu")
        ui.show_lan_menu()
        await settle()
        var deck_control: Button = ui.find_child("NetworkDeck", true, false)
        check(title in deck_control.text and ui.get_viewport_rect().encloses(deck_control.get_global_rect()), "long deck name fits connection action: " + str(deck_control.get_global_rect()) + " viewport=" + str(ui.get_viewport_rect()))
    initial = ui.profile.state()
    ui.show_lan_menu()
    var old = ui.lan
    ui.remove_child(old)
    old.queue_free()
    var stub = NoSocketSession.new()
    ui.lan = stub
    ui.add_child(stub)
    stub.view_changed.connect(ui._network_view)
    stub.connection_changed.connect(ui._network_status)
    var joined: Dictionary = ui.join_lan_room(invite)
    await settle()
    check(joined.ok and ui.online and stub.attempts == 1, "no-socket fixture models accepted asynchronous start")
    check(ui.connection_retry_button.visible and ui.lobby_status.text == ui.network_error("connection_failed"), "synchronous failure isn't lost when progress page is built")
    ui.cancel_connection()
    await settle()
    check(not ui.online and ui.network_page and ui.invite_input.text == invite and stub.attempts == 1, "cancel restores invitation without an automatic retry")
    var hosted: Dictionary = ui.create_lan_room()
    await settle()
    check(hosted.ok and stub.running, "no-socket host fixture")
    ui.request_close_room()
    await settle()
    var confirmation: ConfirmationDialog = ui.find_child("CloseRoomPrompt", true, false)
    check(confirmation != null and confirmation.visible and stub.running, "closing a waiting room requires explicit confirmation")
    confirmation.confirmed.emit()
    await settle()
    check(not stub.running and not ui.online and ui.network_page, "confirmed close returns to connection screen")
    ui.show_menu()
    check(ui.profile.state() == initial, "all connection UI fixtures preserve personal-shaped profile")
    ui.queue_free()
    await settle()
    if failures == 0:
        for name in ["a.json","b.json"]:
            DirAccess.remove_absolute(directory.path_join(name))
        DirAccess.remove_absolute(directory)
        print("MULTIMENTAL_CONNECTION_UI_PASS checks=" + str(checks) + " layouts=8 actual_sockets=0")
    quit(0 if failures == 0 else 1)
