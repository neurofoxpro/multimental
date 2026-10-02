extends RefCounted
## Screen composition only. Existing LAN/Bluetooth sessions own validation and transport.
const Style = preload("res://src/ui_theme.gd")
static func add_action(ui, name: String, text: String, callback: Callable, primary: bool = false) -> Button:
    var control: Button = ui.button(text, callback, 66)
    control.name = name
    Style.decorate_button(control, primary)
    ui.root.add_child(control)
    return control

static func build(ui, bluetooth: bool) -> void:
    preload("res://src/scrollable_page.gd").wrap(ui.root)
    ui.root.add_child(ui.label("BLUETOOTH" if bluetooth else ui.t("ДУЭЛЬ ПО WI-FI / LAN", "WI-FI / LAN DUEL"), 28))
    ui.root.add_child(ui.label(ui.t("1. Выберите колоды  ·  2. Создайте комнату  ·  3. Передайте приглашение", "1. Choose decks  ·  2. Create a room  ·  3. Share the invitation"), 18))
    ui.lobby_status = ui.label("", 19)
    ui.lobby_status.name = "ConnectionStatus"
    ui.root.add_child(ui.lobby_status)
    ui._network_deck_summary()
    var allowed: Dictionary = {"ok": true}
    if bluetooth:
        ui.root.add_child(ui.label(ui.t("Сначала сопрягите устройства в настройках Android. Интернет и Wi-Fi для игры не нужны.", "Pair the devices in Android settings first. The game needs neither internet nor Wi-Fi."), 18))
        allowed = BluetoothChannel.available()
        add_action(ui, "NearbyPermission", ui.t("РАЗРЕШИТЬ УСТРОЙСТВА ПОБЛИЗОСТИ", "ALLOW NEARBY DEVICES"), func(): OS.request_permission("android.permission.BLUETOOTH_CONNECT"))
        add_action(ui, "RefreshPeers", ui.t("ОБНОВИТЬ УСТРОЙСТВА", "REFRESH DEVICES"), ui.show_bluetooth_menu)
    else:
        ui.root.add_child(ui.label(ui.t("Оба устройства — в одной локальной сети. Внешний сервер не нужен. Отладка по Wi-Fi не требуется для самой игры.", "Use the same local network on both devices. No external server or wireless debugging is needed to play."), 18))
    var heading: Label = ui.label(ui.t("Я СОЗДАЮ КОМНАТУ", "I AM HOSTING"), 18)
    heading.add_theme_color_override("font_color", Style.ACCENT)
    ui.root.add_child(heading)
    if not bluetooth:
        ui.network_addresses = OptionButton.new()
        ui.network_addresses.name = "NetworkAddress"
        ui.network_addresses.fit_to_longest_item = false
        ui.network_addresses.custom_minimum_size.y = 58
        for item in RoomInvite.address_options(IP.get_local_interfaces()):
            ui.network_addresses.add_item(str(item.name) + " · " + str(item.address))
            ui.network_addresses.set_item_metadata(ui.network_addresses.item_count - 1, str(item.address))
        ui.root.add_child(ui.network_addresses)
    ui.connection_create_button = add_action(ui, "CreateRoom", ui.t("СОЗДАТЬ КОМНАТУ", "CREATE ROOM"), func():
        var address: String = ""
        if not bluetooth and ui.network_addresses.item_count > 0:
            address = str(ui.network_addresses.get_selected_metadata())
        ui.create_lan_room(address)
    , true)
    ui.connection_create_button.disabled = not allowed.ok or (not bluetooth and ui.network_addresses.item_count == 0)
    heading = ui.label(ui.t("Я ПРИСОЕДИНЯЮСЬ", "I AM JOINING"), 18)
    heading.add_theme_color_override("font_color", Style.ACCENT)
    ui.root.add_child(heading)
    if bluetooth:
        ui.bluetooth_devices = OptionButton.new()
        ui.bluetooth_devices.name = "PairedDevices"
        ui.bluetooth_devices.fit_to_longest_item = false
        ui.bluetooth_devices.custom_minimum_size.y = 58
        for device in BluetoothChannel.bonded():
            ui.bluetooth_devices.add_item(str(device.name))
            ui.bluetooth_devices.set_item_metadata(ui.bluetooth_devices.item_count - 1, str(device.address))
        ui.root.add_child(ui.bluetooth_devices)
    ui.invite_input = TextEdit.new()
    ui.invite_input.name = "RoomInvitation"
    ui.invite_input.custom_minimum_size.y = 135
    ui.invite_input.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
    ui.invite_input.placeholder_text = "multimental-bt://join/…" if bluetooth else "multimental://join/…"
    ui.invite_input.text = str(ui.invitation_drafts["bluetooth" if bluetooth else "lan"])
    ui.root.add_child(ui.invite_input)
    add_action(ui, "PasteInvite", ui.t("ВСТАВИТЬ ПРИГЛАШЕНИЕ", "PASTE INVITATION"), ui.paste_invitation)
    ui.connection_join_button = add_action(ui, "JoinRoom", ui.t("ПОДКЛЮЧИТЬСЯ", "JOIN ROOM"), func():
        if bluetooth:
            if ui.bluetooth_devices.item_count == 0:
                ui._show_network_status("select_paired_device", true)
                return
            ui.lan.target_address = str(ui.bluetooth_devices.get_selected_metadata())
        ui.join_lan_room(ui.invite_input.text)
    , true)
    ui.invite_input.text_changed.connect(ui.remember_invitation)
    ui.remember_invitation()
    ui.root.add_child(ui.label(ui.t("Приглашение открывает доступ к комнате. Не публикуйте его. Черновик остаётся только в памяти приложения.", "The invitation grants room access. Keep it private. The draft is held only in app memory."), 17))
    var back: Button = add_action(ui, "NetworkBack", ui.t("В МЕНЮ", "MENU"), ui.show_menu)
    if not allowed.ok:
        ui._show_network_status(str(allowed.error), false)
    elif not bluetooth and ui.network_addresses.item_count == 0:
        ui._show_network_status("no_local_address", false)
    # The initial focus must not scroll away the chosen deck or connection error.
    ui.call_deferred("_focus_connection_start", weakref(ui.find_child("NetworkDeck", true, false)))
