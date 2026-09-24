extends Control
const Core = preload("res://src/match_core.gd")
const COLORS: Array[Color] = [Color("e76f51"), Color("4ea8de"), Color("f6ce55"), Color("9cdbd3"), Color("ab9366")]
var game = Core.new()
var audio = preload("res://src/audio_director.gd").new()
var tutorial: bool = false
var tutorial_step: int = 0
var tutorial_hint: Label
var language: String = "ru"
var battle: bool = false
var selected_hand: int = -1
var selected_unit: int = -1
var deadline: float = 0.0
var match_end: float = 0.0
var bot_due: float = 0.0
var last_second: int = -1
var root: VBoxContainer
var info: Label
var timer_text: Label
var message: Label
var board_buttons: Array[Button] = []
var hand_row: HBoxContainer
var in_refresh: bool = false
var online: bool = false
var network_page: bool = false
var displayed_revision: int = -1
var result_saved: bool = false
var lan = preload("res://src/net/lan_session.gd").new()
var lobby_status: Label
var invite_input: TextEdit
var network_addresses: OptionButton
var bluetooth_mode: bool = false
var bluetooth_devices: OptionButton

func t(ru: String, en: String) -> String:
    return ru if language == "ru" else en

func _ready() -> void:
    RenderingServer.set_default_clear_color(Color("091322"))
    var cfg := ConfigFile.new()
    if cfg.load("user://settings.cfg") == OK:
        language = str(cfg.get_value("ui", "language", "ru"))
    add_child(audio)
    add_child(lan)
    lan.view_changed.connect(_network_view)
    lan.connection_changed.connect(_network_status)
    show_menu()
    print("MULTIMENTAL_READY " + BuildInfo.VERSION)
    if OS.is_debug_build():
        var lab = load("res://src/device_lab.gd").new()
        lab.ui = self
        get_tree().root.call_deferred("add_child", lab)

func label(text: String, size_px: int = 20) -> Label:
    var node := Label.new()
    node.text = text
    node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    node.add_theme_font_size_override("font_size", size_px)
    node.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    return node

func button(text: String, callback: Callable, height: int = 62) -> Button:
    var node := Button.new()
    node.text = text
    node.custom_minimum_size.y = height
    node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    node.add_theme_font_size_override("font_size", 19)
    var style := StyleBoxFlat.new()
    style.bg_color = Color("203856")
    style.set_corner_radius_all(10)
    style.content_margin_left = 10
    style.content_margin_right = 10
    node.add_theme_stylebox_override("normal", style)
    var hover := style.duplicate() as StyleBoxFlat
    hover.bg_color = Color("345778")
    node.add_theme_stylebox_override("hover", hover)
    node.pressed.connect(callback)
    return node

func clear_screen() -> void:
    for child in get_children():
        if child == lan or child == audio:
            continue
        remove_child(child)
        child.queue_free()
    board_buttons.clear()
    var margin := MarginContainer.new()
    margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    margin.add_theme_constant_override("margin_left", 20)
    margin.add_theme_constant_override("margin_right", 20)
    margin.add_theme_constant_override("margin_top", 30)
    margin.add_theme_constant_override("margin_bottom", 25)
    add_child(margin)
    root = VBoxContainer.new()
    root.add_theme_constant_override("separation", 12)
    margin.add_child(root)

func show_menu() -> void:
    if online:
        lan.leave()
    online = false
    network_page = false
    battle = false
    tutorial = false
    clear_screen()
    root.add_child(label("MULTIMENTAL", 36))
    root.add_child(label(t("Играбельная альфа · 5 стихий · поле 3×3", "Playable alpha · 5 elements · 3×3 board"), 18))
    var space := Control.new()
    space.size_flags_vertical = Control.SIZE_EXPAND_FILL
    root.add_child(space)
    root.add_child(button(t("ИГРАТЬ ПРОТИВ ИИ", "PLAY AGAINST AI"), start_match, 78))
    root.add_child(button(t("ИГРА ПО ЛОКАЛЬНОЙ СЕТИ", "LOCAL NETWORK MATCH"), show_lan_menu, 70))
    if OS.has_feature("android"):
        root.add_child(button(t("ИГРА ПО BLUETOOTH", "BLUETOOTH MATCH"), show_bluetooth_menu, 64))
    root.add_child(label(t("Одна карта или одна атака за ход.\nЗайми 5 клеток. Атаки — по соседним клеткам.\nМонеты восстанавливаются каждый ход.", "One card or attack per turn.\nOccupy 5 cells. Attack adjacent enemies.\nCoins refill each turn."), 20))
    root.add_child(button(t("ОБУЧЕНИЕ", "TUTORIAL"), start_tutorial, 58))
    root.add_child(button(t("НАСТРОЙКИ ЗВУКА", "AUDIO SETTINGS"), show_audio_settings, 58))
    root.add_child(button(t("ЯЗЫК: РУССКИЙ", "LANGUAGE: ENGLISH"), toggle_language))
    root.add_child(label(t("Коллекция, магазин и сложные свойства — в следующих версиях.", "Collection, shop and advanced abilities come in later builds."), 16))
    var bottom := Control.new()
    bottom.size_flags_vertical = Control.SIZE_EXPAND_FILL
    root.add_child(bottom)
    root.add_child(label(BuildInfo.VERSION + " · " + BuildInfo.COMMIT, 14))

func toggle_language() -> void:
    language = "en" if language == "ru" else "ru"
    var cfg := ConfigFile.new()
    cfg.set_value("ui", "language", language)
    cfg.save("user://settings.cfg")
    show_menu()

func start_match() -> void:
    tutorial = false
    tutorial_step = 0
    last_second = -1
    lan.stop()
    online = false
    network_page = false
    result_saved = false
    game.start(int(Time.get_unix_time_from_system()) % 2147483646 + 1)
    match_end = Time.get_unix_time_from_system() + 900.0
    deadline = Time.get_unix_time_from_system() + 30.0
    bot_due = Time.get_unix_time_from_system() + 0.65
    battle = true
    selected_hand = -1
    selected_unit = -1
    build_battle()
    refresh()
    print("MULTIMENTAL_MATCH_STARTED")

func build_battle() -> void:
    clear_screen()
    root.add_child(label("MULTIMENTAL", 27))
    info = label("", 19)
    root.add_child(info)
    timer_text = label("", 18)
    root.add_child(timer_text)
    tutorial_hint = null
    if tutorial:
        tutorial_hint = label("", 17)
        root.add_child(tutorial_hint)
    var aspect := AspectRatioContainer.new()
    aspect.ratio = 1.0
    aspect.stretch_mode = AspectRatioContainer.STRETCH_FIT
    aspect.size_flags_vertical = Control.SIZE_EXPAND_FILL
    root.add_child(aspect)
    var grid := GridContainer.new()
    grid.columns = 3
    grid.add_theme_constant_override("h_separation", 8)
    grid.add_theme_constant_override("v_separation", 8)
    aspect.add_child(grid)
    for cell in range(9):
        var b: Button = button("·", on_cell.bind(cell), 112)
        b.custom_minimum_size.x = 140
        b.size_flags_vertical = Control.SIZE_EXPAND_FILL
        grid.add_child(b)
        board_buttons.append(b)
    message = label("", 18)
    root.add_child(message)
    var scroll := ScrollContainer.new()
    scroll.custom_minimum_size.y = 125
    scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
    root.add_child(scroll)
    hand_row = HBoxContainer.new()
    hand_row.add_theme_constant_override("separation", 8)
    scroll.add_child(hand_row)
    var row := HBoxContainer.new()
    root.add_child(row)
    row.add_child(button(t("ПРОПУСТИТЬ", "PASS"), pass_turn))
    row.add_child(button(t("В МЕНЮ", "MENU"), show_menu))
    root.add_child(label(BuildInfo.VERSION + " · " + BuildInfo.COMMIT, 12))

func on_hand(index: int) -> void:
    var view: Dictionary = _view()
    if view.is_empty() or index < 0 or index >= view.hand.size():
        return
    selected_hand = -1 if selected_hand == index else index
    selected_unit = -1
    if tutorial and selected_hand >= 0:
        tutorial_step = maxi(tutorial_step, 1)
    refresh()

func on_cell(index: int) -> void:
    var view: Dictionary = _view()
    if view.is_empty() or view.winner != -1 or view.active != 0 or index < 0 or index >= 9:
        return
    if selected_hand >= 0:
        act({"type": "play", "hand": selected_hand, "cell": index})
    elif selected_unit >= 0 and view.board[index] != null and view.board[index].owner == 1:
        act({"type": "attack", "source": selected_unit, "target": index})
    elif view.board[index] != null and view.board[index].owner == 0:
        selected_unit = -1 if selected_unit == index else index
        selected_hand = -1
        refresh()
    else:
        message.text = t("Выбери карту в руке или своего юнита.", "Select a card or your unit first.")

func act(command: Dictionary) -> void:
    var result: Dictionary = lan.submit(command) if online else game.apply(0, command)
    if not result.ok:
        message.text = t("Недопустимая цель, недостаточно монет или ожидание соперника.", "Invalid target, insufficient coins or waiting for the opponent.")
        message.modulate = Color("ff8585")
        return
    audio.play_action()
    if tutorial:
        tutorial_step = maxi(tutorial_step, 2)
    after_action()

func pass_turn() -> void:
    var view: Dictionary = _view()
    if not view.is_empty() and view.active == 0 and view.winner == -1:
        act({"type": "pass"})

func after_action() -> void:
    selected_hand = -1
    selected_unit = -1
    if online:
        refresh()
        return
    deadline = Time.get_unix_time_from_system() + 30.0
    bot_due = Time.get_unix_time_from_system() + 0.65
    refresh()
    _save_finished_match()

func _save_finished_match() -> void:
    if not online and game.state.winner != -1 and not result_saved:
        result_saved = true
        var file := FileAccess.open("user://last-match.json", FileAccess.WRITE)
        if file != null:
            file.store_string(JSON.stringify({"version": 1, "seed": game.initial_seed, "commands": game.commands, "result": game.state.reason}))
        print("MULTIMENTAL_MATCH_FINISHED " + str(game.state.winner))

func _process(_delta: float) -> void:
    if online:
        if battle and is_instance_valid(timer_text) and not lan.current_view.is_empty():
            timer_text.text = t("Ход %d · осталось %d с", "Turn %d · %d s remaining") % [lan.current_view.turn, lan.remaining_seconds()]
        return
    if not battle or game.state.winner != -1:
        return
    var now: float = Time.get_unix_time_from_system()
    if now >= match_end:
        game.end_on_time_limit()
        after_action()
        return
    if tutorial:
        deadline = now + 30.0
    # Reconcile missed deadlines after suspension without relying on rendered frames.
    for i in range(6):
        if now < deadline or game.state.winner != -1:
            break
        if game.state.active == 1:
            game.apply(1, game.choose_ai())
        else:
            game.timeout(0)
        deadline += 30.0
        bot_due = now + 0.65
        selected_hand = -1
        selected_unit = -1
        refresh()
    if game.state.winner == -1 and game.state.active == 1 and now >= bot_due:
        game.apply(1, game.choose_ai())
        after_action()
    _save_finished_match()
    var second: int = maxi(0, int(ceil(deadline - now)))
    if second != last_second:
        last_second = second
        timer_text.text = t("Ход %d · осталось %d с", "Turn %d · %d s remaining") % [game.state.turn, second]

func _view() -> Dictionary:
    return lan.current_view if online else MatchView.for_player(game, 0)

func refresh() -> void:
    if not battle:
        return
    var view: Dictionary = _view()
    if view.is_empty():
        return
    var opponent: String = t("Соперник", "Opponent") if online else t("ИИ", "AI")
    info.text = t("Ты: %d/5 · %s: %d/5\nМонеты: %d · Колода: %d · Рука соперника: %d", "You: %d/5 · %s: %d/5\nCoins: %d · Deck: %d · Opponent hand: %d") % [view.scores[0], opponent, view.scores[1], view.coins, view.deck_count, view.opponent_hand_count]
    var legal: Array = view.legal
    for i in range(9):
        var unit: Variant = view.board[i]
        var b: Button = board_buttons[i]
        b.modulate = Color.WHITE
        if unit == null:
            b.text = "·"
        else:
            var def: Dictionary = game.card(int(unit.id))
            b.text = (t("ТВОЙ", "YOURS") if unit.owner == 0 else t("ВРАГ", "ENEMY")) + "\n" + str(def[language]) + "\n⚔ %d   ♥ %d" % [unit.attack, unit.health]
            b.modulate = COLORS[int(def.element)]
        var highlight: bool = false
        for c in legal:
            if (c.type == "play" and selected_hand >= 0 and c.hand == selected_hand and c.cell == i) or (c.type == "attack" and selected_unit >= 0 and c.source == selected_unit and c.target == i):
                highlight = true
        if highlight:
            b.modulate = Color("a4ffc3")
    for child in hand_row.get_children():
        hand_row.remove_child(child)
        child.queue_free()
    for i in range(view.hand.size()):
        var def: Dictionary = game.card(int(view.hand[i]))
        var b: Button = button(str(def[language]) + "\n◉ %d\n⚔ %d   ♥ %d" % [def.cost, def.attack, def.health], on_hand.bind(i), 116)
        b.custom_minimum_size.x = 134
        b.disabled = view.active != 0 or view.winner != -1 or int(def.cost) > int(view.coins) or (online and not lan.pending.is_empty())
        b.modulate = COLORS[int(def.element)] if i != selected_hand else Color.WHITE
        hand_row.add_child(b)
    message.modulate = Color.WHITE
    if tutorial and is_instance_valid(tutorial_hint):
        var hints: Array = [["Выбери доступную карту в руке. Число ◉ — её стоимость.", "Choose an affordable card in your hand. ◉ shows its cost."], ["Теперь коснись свободной подсвеченной клетки.", "Now tap a highlighted empty cell."], ["Продолжай до пяти клеток. Для атаки выбери своего юнита и соседнего врага. Таймер в обучении не наказывает за раздумья.", "Continue until you occupy five cells. Attack by selecting your unit and an adjacent enemy. The tutorial does not punish time spent reading."]]
        tutorial_hint.text = t(hints[mini(tutorial_step,2)][0],hints[mini(tutorial_step,2)][1])
    if view.winner != -1:
        message.text = t("ПОБЕДА", "VICTORY") if view.winner == 0 else (t("НИЧЬЯ", "DRAW") if view.winner == 2 else t("ПОРАЖЕНИЕ", "DEFEAT"))
        message.text += " · " + reason_text(str(view.reason))
    elif online and view.get("phase") == "reconnecting":
        message.text = t("Соперник отключился. Ожидаем возвращения…", "Opponent disconnected. Waiting to reconnect…")
    elif view.active == 1:
        message.text = t("Ход соперника…", "Opponent turn…") if online else t("Ход ИИ…", "AI turn…")
    elif selected_hand >= 0:
        message.text = t("Выбери свободную подсвеченную клетку", "Choose a highlighted empty cell")
    elif selected_unit >= 0:
        message.text = t("Выбери соседнего врага для атаки", "Choose an adjacent enemy to attack")
    else:
        message.text = t("Выбери карту или своего юнита", "Choose a card or your unit")

func reason_text(reason: String) -> String:
    var texts: Dictionary = {"five": ["занято 5 клеток", "five cells occupied"], "empty": ["закончились карты", "no cards left"], "timeout": ["два пропущенных хода", "two missed turns"], "limit": ["истекло время матча", "match time limit"], "disconnect": ["соперник не вернулся", "opponent did not return"], "resigned": ["игрок вышел", "player left"]}
    if texts.has(reason):
        return t(texts[reason][0], texts[reason][1])
    return reason

func show_lan_menu() -> void:
    _switch_transport(false)
    lan.stop()
    online = false
    network_page = true
    battle = false
    clear_screen()
    root.add_child(label(t("ЛОКАЛЬНАЯ СЕТЬ", "LOCAL NETWORK"), 30))
    root.add_child(label(t("Оба устройства должны быть в одной сети Wi-Fi. Внешний сервер не нужен.", "Connect both devices to the same Wi-Fi network. No external server is required."), 19))
    network_addresses = OptionButton.new()
    network_addresses.custom_minimum_size.y = 58
    for item in RoomInvite.address_options(IP.get_local_interfaces()):
        network_addresses.add_item(str(item.name) + " · " + str(item.address))
        network_addresses.set_item_metadata(network_addresses.item_count - 1, str(item.address))
    root.add_child(network_addresses)
    root.add_child(button(t("СОЗДАТЬ КОМНАТУ", "CREATE ROOM"), func():
        var address: String = str(network_addresses.get_selected_metadata()) if network_addresses.item_count > 0 else ""
        create_lan_room(address)
    , 76))

    root.add_child(label(t("Или вставь приглашение другого игрока:", "Or paste another player's invitation:"), 19))
    invite_input = TextEdit.new()
    invite_input.custom_minimum_size.y = 180
    invite_input.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
    invite_input.placeholder_text = "multimental://join/…"
    root.add_child(invite_input)
    root.add_child(button(t("ВСТАВИТЬ ПРИГЛАШЕНИЕ", "PASTE INVITATION"), func(): invite_input.text = DisplayServer.clipboard_get()))
    root.add_child(button(t("ПОДКЛЮЧИТЬСЯ", "JOIN ROOM"), func(): join_lan_room(invite_input.text), 76))
    lobby_status = label("", 18)
    root.add_child(lobby_status)
    root.add_child(button(t("В МЕНЮ", "MENU"), show_menu))

func create_lan_room(address: String = "", port: int = 17844) -> Dictionary:
    online = true
    battle = false
    displayed_revision = -1
    var result: Dictionary = lan.host_room(address, port)
    if not result.ok:
        online = false
        if is_instance_valid(lobby_status):
            lobby_status.text = network_error(str(result.error))
        return result
    clear_screen()
    root.add_child(label(t("КОМНАТА СОЗДАНА", "ROOM CREATED"), 30))
    root.add_child(label(t("Передай приглашение второму игроку. Не публикуй его: оно даёт доступ к этой комнате.", "Share the invitation with the other player. Keep it private: it grants access to this room."), 19))
    var text := TextEdit.new()
    text.text = lan.invitation
    text.editable = false
    text.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
    text.custom_minimum_size.y = 220
    root.add_child(text)
    root.add_child(button(t("СКОПИРОВАТЬ ПРИГЛАШЕНИЕ", "COPY INVITATION"), func(): DisplayServer.clipboard_set(lan.invitation)))
    lobby_status = label(t("Ожидаем второго игрока…", "Waiting for another player…"), 20)
    root.add_child(lobby_status)
    root.add_child(label(t("Защищённое Bluetooth-соединение требует сопряжения устройств в Android.", "Secure Bluetooth requires Android device pairing.") if bluetooth_mode else t("Соединение шифруется. Сертификат комнаты проверяется по приглашению.", "The connection is encrypted. The invitation pins the room certificate."), 17))
    root.add_child(button(t("ЗАКРЫТЬ КОМНАТУ", "CLOSE ROOM"), show_menu))
    return result

func join_lan_room(text: String) -> Dictionary:
    online = true
    battle = false
    displayed_revision = -1
    var result: Dictionary = lan.join_room(text)
    if not result.ok:
        online = false
        if is_instance_valid(lobby_status):
            lobby_status.text = network_error(str(result.error))
        return result
    clear_screen()
    root.add_child(label(t("ПОДКЛЮЧЕНИЕ", "CONNECTING"), 30))
    lobby_status = label(t("Проверяем комнату и защищённое соединение…", "Checking the room and secure connection…"), 20)
    root.add_child(lobby_status)
    root.add_child(button(t("ОТМЕНА", "CANCEL"), show_menu))
    return result

func network_error(value: String) -> String:
    var messages: Dictionary = {"no_local_address": ["Подключись к Wi-Fi и попробуй снова.", "Connect to Wi-Fi and try again."], "port_busy": ["Порт комнаты занят. Закрой другую комнату.", "Room port is busy. Close the other room."], "invalid_invite": ["Приглашение повреждено или неполное.", "Invitation is invalid or incomplete."], "incompatible_or_nonlocal_invite": ["Нужна совместимая версия и приглашение из локальной сети.", "A compatible version and local-network invitation are required."], "certificate_mismatch": ["Сертификат комнаты не совпал. Подключение остановлено.", "Room certificate mismatch. Connection stopped."], "connection_failed": ["Не удалось подключиться. Проверь сеть и приглашение.", "Connection failed. Check the network and invitation."], "connection_lost": ["Связь не восстановлена. Вернись в меню.", "Connection could not be restored. Return to the menu."], "reconnecting": ["Восстанавливаем соединение…", "Reconnecting…"], "waiting_reconnect": ["Ожидаем возвращения соперника…", "Waiting for the opponent to reconnect…"]}
    messages.merge({"android_bluetooth_required": ["Bluetooth доступен в Android-клиенте.", "Bluetooth is available in the Android client."], "bluetooth_permission_required": ["Разреши доступ к устройствам поблизости и обнови список.", "Allow nearby-device access and refresh the list."], "bluetooth_disabled": ["Включи Bluetooth в настройках Android.", "Enable Bluetooth in Android settings."], "select_paired_device": ["Выбери ранее сопряжённое устройство.", "Select an already paired device."], "pair_device_in_android_settings": ["Сначала сопряги устройства в настройках Android.", "Pair the devices in Android settings first."], "secure_connect_failed": ["Защищённое соединение не установлено. Проверь сопряжение и комнату.", "Secure connection failed. Check pairing and the room."]})
    return t(messages[value][0], messages[value][1]) if messages.has(value) else value

func _network_status(status: String) -> void:
    if not online:
        return
    if is_instance_valid(lobby_status):
        lobby_status.text = network_error(status)
    if battle and is_instance_valid(message) and status not in ["connected", "waiting_guest", "idle"]:
        message.text = network_error(status)

func _network_view(view: Dictionary) -> void:
    if not online or view.is_empty() or view.phase == "waiting":
        return
    if not battle:
        battle = true
        selected_hand = -1
        selected_unit = -1
        build_battle()
    if int(view.revision) != displayed_revision:
        displayed_revision = int(view.revision)
        selected_hand = -1
        selected_unit = -1
        refresh()

func _switch_transport(use_bluetooth: bool) -> void:
    if bluetooth_mode == use_bluetooth and is_instance_valid(lan):
        lan.stop()
        return
    online = false
    if is_instance_valid(lan):
        lan.stop()
        remove_child(lan)
        lan.queue_free()
    bluetooth_mode = use_bluetooth
    lan = preload("res://src/net/bluetooth_session.gd").new() if use_bluetooth else preload("res://src/net/lan_session.gd").new()
    add_child(lan)
    lan.view_changed.connect(_network_view)
    lan.connection_changed.connect(_network_status)

func show_bluetooth_menu() -> void:
    _switch_transport(true)
    online = false
    battle = false
    network_page = true
    clear_screen()
    root.add_child(label("BLUETOOTH", 30))
    root.add_child(label(t("Сначала сопряги два устройства в настройках Android. Интернет и Wi-Fi не нужны.", "Pair the devices in Android settings first. Internet and Wi-Fi are not required."), 19))
    var available: Dictionary = BluetoothChannel.available()
    lobby_status = label("" if available.ok else network_error(str(available.error)), 18)
    root.add_child(lobby_status)
    root.add_child(button(t("РАЗРЕШИТЬ УСТРОЙСТВА ПОБЛИЗОСТИ", "ALLOW NEARBY DEVICES"), func(): OS.request_permission("android.permission.BLUETOOTH_CONNECT"), 60))
    root.add_child(button(t("ОБНОВИТЬ СПИСОК", "REFRESH DEVICES"), show_bluetooth_menu, 60))
    root.add_child(button(t("СОЗДАТЬ КОМНАТУ", "CREATE ROOM"), func(): create_lan_room(), 68))
    bluetooth_devices = OptionButton.new()
    bluetooth_devices.custom_minimum_size.y = 58
    for device in BluetoothChannel.bonded():
        bluetooth_devices.add_item(str(device.name))
        bluetooth_devices.set_item_metadata(bluetooth_devices.item_count - 1, str(device.address))
    root.add_child(bluetooth_devices)
    invite_input = TextEdit.new()
    invite_input.custom_minimum_size.y = 135
    invite_input.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
    invite_input.placeholder_text = "multimental-bt://join/…"
    root.add_child(invite_input)
    root.add_child(button(t("ВСТАВИТЬ ПРИГЛАШЕНИЕ", "PASTE INVITATION"), func(): invite_input.text = DisplayServer.clipboard_get(), 60))
    root.add_child(button(t("ПОДКЛЮЧИТЬСЯ", "JOIN ROOM"), func():
        if bluetooth_devices.item_count == 0:
            lobby_status.text = network_error("select_paired_device")
            return
        lan.target_address = str(bluetooth_devices.get_selected_metadata())
        join_lan_room(invite_input.text)
    , 68))
    root.add_child(button(t("В МЕНЮ", "MENU"), show_menu, 60))

func start_tutorial() -> void:
    start_match()
    tutorial = true
    tutorial_step = 0
    game.start(42)
    build_battle()
    refresh()

func show_audio_settings() -> void:
    battle = false
    online = false
    tutorial = false
    clear_screen()
    root.add_child(label(t("НАСТРОЙКИ ЗВУКА", "AUDIO SETTINGS"), 30))
    var categories: Dictionary = {"master": ["Общая громкость", "Master volume"], "music": ["Музыка", "Music"], "effects": ["Эффекты", "Effects"]}
    for category in ["master", "music", "effects"]:
        root.add_child(label(t(categories[category][0],categories[category][1]), 21))
        var slider := HSlider.new()
        slider.name = "Volume_" + category
        slider.min_value = 0.0
        slider.max_value = 1.0
        slider.step = 0.01
        slider.custom_minimum_size.y = 64
        slider.value = float(audio.settings[category])
        slider.value_changed.connect(func(value: float): audio.set_volume(category, value))
        root.add_child(slider)
    root.add_child(button(t("ПРОВЕРИТЬ ЭФФЕКТ", "TEST SOUND"), func(): audio.play_action()))
    root.add_child(label(t("Настройки сохраняются автоматически. При сворачивании приложения звук приостанавливается.", "Settings save automatically. Audio pauses while the application is in the background."), 18))
    root.add_child(button(t("В МЕНЮ", "MENU"), func(): audio.flush(); show_menu()))
