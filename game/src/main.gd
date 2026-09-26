extends Control
const Core = preload("res://src/match_core.gd")
const UIStyle = preload("res://src/ui_theme.gd")
var leave_confirm: ConfirmationDialog
var invitation_drafts: Dictionary = {"lan": "", "bluetooth": ""}
var connection_return_mode: String = ""
var connection_join_button: Button
var connection_create_button: Button
var connection_retry_button: Button
const Collection = preload("res://src/collection_rules.gd")
var collection_error: String = ""
const Feedback = preload("res://src/combat_feedback.gd")
const COLORS: Array[Color] = [Color("e76f51"), Color("4ea8de"), Color("f6ce55"), Color("9cdbd3"), Color("ab9366"), Color("fff0ad"), Color("ad8acc"), Color("9fafbb"), Color("a6cf64"), Color("d788c9")]
var game = Core.new()
var profile = preload("res://src/profile_controller.gd").new()
var profile_directory: String = "user://profile"
var profile_legacy_settings: String = "user://settings.cfg"
var local_match_id: String = ""
var local_result_command: Dictionary = {}
var audio = preload("res://src/audio_director.gd").new()
var tutorial: bool = false
var tutorial_step: int = 0
var tutorial_hint: Label
var language: String = "ru"
var battle: bool = false
var selected_hand: int = -1
var selected_unit: int = -1
var selected_direction: int = 0
var timed_turn: int = -1
var last_animated_event: int = -1
var damage_effects_total: int = 0
var rotation_left: Button
var rotation_right: Button
var aim_label: Label
var end_turn_button: Button
var sweep_button: Button
var last_center_open: bool = false
var center_unlock_effects: int = 0
var friendly_confirm: ConfirmationDialog
var friendly_pending: Dictionary = {}
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
    theme = UIStyle.build()
    RenderingServer.set_default_clear_color(UIStyle.BACKGROUND)
    var cfg := ConfigFile.new()
    if cfg.load("user://settings.cfg") == OK:
        language = str(cfg.get_value("ui", "language", "ru"))
    if OS.is_debug_build() and FileAccess.file_exists("user://automation-request.json"):
        profile.enabled = false
    profile.storage = preload("res://src/profile_store.gd").new(profile_directory)
    profile.legacy_settings = profile_legacy_settings
    profile.open_profile()
    language = profile.language(language)
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
    UIStyle.decorate_button(node)
    node.pressed.connect(callback)
    return node

func clear_screen() -> void:
    last_animated_event = -1
    last_center_open = false
    friendly_pending = {}
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
    margin.add_theme_constant_override("margin_top", 24)
    margin.add_theme_constant_override("margin_bottom", 20)
    add_child(margin)
    root = VBoxContainer.new()
    root.add_theme_constant_override("separation", 12)
    margin.add_child(root)

func show_menu() -> void:
    remember_invitation()
    connection_return_mode = ""
    if battle:
        _save_finished_match()
    if online:
        lan.leave()
    online = false
    network_page = false
    battle = false
    tutorial = false
    clear_screen()
    preload("res://src/scrollable_page.gd").wrap(root)
    preload("res://src/home_screen.gd").build(self, root)

func _focus_control(reference: WeakRef) -> void:
    var control: Variant = reference.get_ref()
    if control != null and control.is_inside_tree() and not control.is_queued_for_deletion():
        control.grab_focus()

func toggle_language() -> void:
    var chosen: String = "en" if language == "ru" else "ru"
    if profile.commit({"kind": "language", "value": chosen}):
        language = chosen
    show_menu()

func ensure_collection() -> bool:
    collection_error = ""
    if not profile.enabled:
        collection_error = t("Личный профиль отключён в диагностике", "Personal profile is disabled in diagnostics")
        return false
    if not profile.flush():
        collection_error = profile.error
        return false
    if not profile.state().has("collection") and not profile.commit({"kind": "collection_init"}):
        collection_error = profile.error
        return false
    return Collection.valid(profile.state())

func rewards_day() -> int:
    return int(floor(Time.get_unix_time_from_system() / 86400.0))

func _commit_finished_result(outcome: String, replay: Dictionary) -> bool:
    if local_result_command.is_empty() or local_result_command.get("replay", {}).get("session", "") != replay.get("session", ""):
        if not profile.flush():
            return false
        local_result_command = {"kind": "reward_match", "policy": preload("res://src/rewards_policy.gd").POLICY, "matchNumber": int(profile.state().stats.matches) + 1, "day": rewards_day(), "outcome": outcome, "replay": replay.duplicate(true)}
    var saved: bool = profile.commit(local_result_command)
    if saved and is_instance_valid(message):
        var reward: Dictionary = preload("res://src/rewards_policy.gd").match_reward(outcome)
        message.text += t(" · +%d монет · +%d опыта", " · +%d coins · +%d XP") % [reward.gold, reward.xp]
    return saved

func show_rewards() -> void:
    if not profile.enabled or not profile.flush():
        show_menu()
        return
    lan.stop()
    online = false
    battle = false
    tutorial = false
    network_page = false
    clear_screen()
    var screen = preload("res://src/rewards_screen.gd").new()
    root.add_child(screen)
    screen.leave_requested.connect(show_menu)
    screen.setup(self)
func show_crafting() -> void:
    if not ensure_collection():
        show_menu()
        return
    lan.stop()
    online = false
    battle = false
    tutorial = false
    network_page = false
    clear_screen()
    var screen = preload("res://src/crafting_screen.gd").new()
    root.add_child(screen)
    screen.leave_requested.connect(show_menu)
    screen.setup(self)

func show_shop() -> void:
    if not ensure_collection():
        show_menu()
        return
    if not profile.state().has("economy") and not profile.commit({"kind": "economy_init"}):
        collection_error = profile.error
        show_menu()
        return
    lan.stop()
    online = false
    battle = false
    tutorial = false
    network_page = false
    clear_screen()
    var screen = preload("res://src/shop_screen.gd").new()
    root.add_child(screen)
    screen.leave_requested.connect(show_menu)
    screen.setup(self)

func show_collection() -> void:
    if not ensure_collection():
        show_menu()
        return
    lan.stop()
    online = false
    battle = false
    tutorial = false
    network_page = false
    clear_screen()
    var screen = preload("res://src/collection_screen.gd").new()
    root.add_child(screen)
    screen.leave_requested.connect(return_from_collection)
    screen.play_requested.connect(start_match)
    screen.setup(self)
    if connection_return_mode != "":
        screen.back_button.text = t("К ПОДКЛЮЧЕНИЮ", "BACK TO CONNECTION")

func start_match(use_starter: bool = false) -> void:
    if not use_starter and not profile.flush():
        show_menu()
        return
    tutorial = false
    tutorial_step = 0
    last_second = -1
    lan.stop()
    online = false
    network_page = false
    result_saved = false
    local_match_id = Crypto.new().generate_random_bytes(16).hex_encode()
    var seed_value: int = int(Time.get_unix_time_from_system()) % 2147483646 + 1
    if profile.enabled and not use_starter:
        if not ensure_collection():
            show_menu()
            return
        var selected: Dictionary = Collection.selected(profile.state())
        if not selected.ok:
            show_collection()
            return
        var started: Dictionary = game.start_with_decks(seed_value, [selected.ids, Core.STARTER])
        if not started.ok:
            collection_error = str(started.get("code", "invalid_deck"))
            show_menu()
            return
    else:
        game.start(seed_value)
    selected_direction = 0
    timed_turn = int(game.state.turn)
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
    root.add_theme_constant_override("separation", 8)
    root.add_child(label("MULTIMENTAL", 24))
    var layout = preload("res://src/battle_layout.gd").new()
    root.add_child(layout)
    layout.setup()
    var grid := GridContainer.new()
    grid.columns = 3
    grid.add_theme_constant_override("h_separation", 8)
    grid.add_theme_constant_override("v_separation", 8)
    layout.board.add_child(grid)
    for cell in range(9):
        var b: Button = button("·", on_cell.bind(cell), 88)
        b.name = "BoardCell" + str(cell)
        b.custom_minimum_size.x = 88
        b.autowrap_mode = TextServer.AUTOWRAP_OFF
        b.size_flags_vertical = Control.SIZE_EXPAND_FILL
        for state in ["normal", "hover", "pressed", "disabled"]:
            var style: StyleBoxFlat = b.get_theme_stylebox(state).duplicate()
            style.content_margin_top = 3
            style.content_margin_bottom = 3
            style.content_margin_left = 4
            style.content_margin_right = 4
            b.add_theme_stylebox_override(state, style)
        grid.add_child(b)
        board_buttons.append(b)
    info = label("", 19)
    info.name = "BattleSummary"
    layout.panel.add_child(info)
    timer_text = label("", 18)
    timer_text.name = "TurnTimer"
    layout.panel.add_child(timer_text)
    tutorial_hint = null
    if tutorial:
        tutorial_hint = label("", 17)
        layout.panel.add_child(tutorial_hint)
    message = label("", 18)
    message.name = "BattleMessage"
    layout.panel.add_child(message)
    var aim_row := HBoxContainer.new()
    layout.panel.add_child(aim_row)
    rotation_left = button("↶", rotate_card.bind(-1), 58)
    rotation_left.name = "RotateLeft"
    rotation_left.tooltip_text = t("Повернуть карту влево", "Rotate card left")
    rotation_left.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
    rotation_left.custom_minimum_size.x = 64
    aim_row.add_child(rotation_left)
    aim_label = label("", 17)
    aim_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    aim_row.add_child(aim_label)
    rotation_right = button("↷", rotate_card.bind(1), 58)
    rotation_right.name = "RotateRight"
    rotation_right.tooltip_text = t("Повернуть карту вправо", "Rotate card right")
    rotation_right.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
    rotation_right.custom_minimum_size.x = 64
    aim_row.add_child(rotation_right)
    sweep_button = button(t("АТАКОВАТЬ ПО СТРЕЛКАМ", "ATTACK ALONG THE ARROWS"), attack_selected, 58)
    sweep_button.name = "SweepAttack"
    layout.panel.add_child(sweep_button)
    friendly_confirm = ConfirmationDialog.new()
    friendly_confirm.title = t("Удар по союзнику", "Friendly fire")
    friendly_confirm.ok_button_text = t("Атаковать", "Attack")
    friendly_confirm.cancel_button_text = t("Отмена", "Cancel")
    friendly_confirm.confirmed.connect(confirm_friendly_attack)
    friendly_confirm.canceled.connect(func(): friendly_pending = {})
    add_child(friendly_confirm)
    UIStyle.decorate_dialog(friendly_confirm)
    var hand_scroll := ScrollContainer.new()
    hand_scroll.name = "HandScroll"
    hand_scroll.custom_minimum_size.y = 164
    hand_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
    hand_scroll.follow_focus = true
    layout.panel.add_child(hand_scroll)
    hand_row = HBoxContainer.new()
    hand_row.add_theme_constant_override("separation", 8)
    hand_scroll.add_child(hand_row)
    var row := HBoxContainer.new()
    row.name = "BattleFooter"
    root.add_child(row)
    end_turn_button = button(t("ЗАКОНЧИТЬ ХОД", "END TURN"), pass_turn)
    end_turn_button.name = "EndTurn"
    row.add_child(end_turn_button)
    var back: Button = button(t("В МЕНЮ", "MENU"), request_leave_match)
    back.name = "BattleBack"
    row.add_child(back)
    leave_confirm = ConfirmationDialog.new()
    leave_confirm.title = t("Выйти из партии?", "Leave the match?")
    leave_confirm.dialog_text = t("Текущая партия будет прервана. Продолжить?", "The current match will be interrupted. Continue?")
    leave_confirm.dialog_autowrap = true
    leave_confirm.ok_button_text = t("Выйти", "Leave")
    leave_confirm.cancel_button_text = t("Остаться", "Stay")
    leave_confirm.confirmed.connect(show_menu)
    add_child(leave_confirm)
    UIStyle.decorate_dialog(leave_confirm)
    root.add_child(label(BuildInfo.VERSION + " · " + BuildInfo.COMMIT, 12))

func request_leave_match() -> void:
    var view: Dictionary = _view()
    if not battle or view.is_empty() or int(view.get("winner", -1)) != -1:
        show_menu()
        return
    leave_confirm.popup_centered_clamped(Vector2i(500, 220), 0.9)

func on_hand(index: int) -> void:
    var view: Dictionary = _view()
    if view.is_empty() or index < 0 or index >= view.hand.size():
        return
    if int(view.active) != 0 or int(view.winner) != -1 or int(view.get("placed_cell", -1)) >= 0:
        return
    selected_hand = -1 if selected_hand == index else index
    selected_direction = 0
    selected_unit = -1
    if tutorial and selected_hand >= 0:
        tutorial_step = maxi(tutorial_step, 1)
    refresh()

func on_cell(index: int) -> void:
    var view: Dictionary = _view()
    if view.is_empty() or view.winner != -1 or view.active != 0 or index < 0 or index >= 9:
        return
    if index == 4 and not bool(view.get("center_unlocked", false)):
        message.text = t("Центр закрыт: нужно 5 юнитов на поле или начало 7-го хода.", "Center locked: five units on the board or turn seven required.")
        return
    if selected_hand >= 0:
        act({"type": "play", "hand": selected_hand, "cell": index, "direction": selected_direction})
    elif selected_unit == index:
        selected_unit = -1
        refresh()
    elif selected_unit >= 0 and view.board[index] != null:
        var command: Dictionary = {"type": "attack", "source": selected_unit, "target": index}
        request_sweep(command)
    elif view.board[index] != null and int(view.board[index].owner) == 0:
        selected_unit = index
        selected_hand = -1
        refresh()
    else:
        message.text = t("Выбери карту в руке или своего юнита.", "Select a card or your unit first.")

func attack_selected() -> void:
    var view: Dictionary = _view()
    for command in view.get("legal", []):
        if command.type == "attack" and int(command.source) == selected_unit:
            request_sweep(command)
            return

func request_sweep(command: Dictionary) -> void:
    var view: Dictionary = _view()
    if command not in view.get("legal", []):
        act(command)
        return
    var allies: int = 0
    for target in game.attack_targets(int(command.source), view.board[int(command.source)], view.board):
        if int(view.board[target].owner) == 0:
            allies += 1
    if allies > 0:
        friendly_pending = command.duplicate()
        friendly_confirm.dialog_text = t("Удар во все направления заденет союзников: %d. Продолжить?", "This sweep will hit %d allies. Continue?") % allies
        friendly_confirm.popup_centered(Vector2i(520, 180))
    else:
        act(command)

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
    if int(game.state.turn) != timed_turn:
        timed_turn = int(game.state.turn)
        deadline = Time.get_unix_time_from_system() + 30.0
    bot_due = Time.get_unix_time_from_system() + 0.65
    refresh()
    _save_finished_match()

func _save_finished_match() -> void:
    if online or game.state.get("winner", -1) == -1 or result_saved:
        return
    if tutorial or not profile.enabled:
        result_saved = true
        return
    var saved_replay: Dictionary = profile.state().get("lastMatch", {}).get("replay", {})
    if local_match_id != "" and saved_replay.get("session", "") == local_match_id:
        result_saved = true
        return
    var outcome: String = "win" if game.state.winner == 0 else ("draw" if game.state.winner == 2 else "loss")
    var replay: Dictionary = {"version": 2, "session": local_match_id, "rules": Core.RULES_ID, "seed": game.initial_seed, "decks": game.initial_decks.duplicate(true), "commands": game.commands.duplicate(true), "result": game.state.reason}
    result_saved = _commit_finished_result(outcome, replay)
    if result_saved:
        print("MULTIMENTAL_MATCH_FINISHED " + str(game.state.winner))
    elif is_instance_valid(message):
        message.text += t(" · не удалось сохранить результат", " · result could not be saved")

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
            for action_index in range(2):
                if int(game.state.active) != 1 or int(game.state.winner) != -1:
                    break
                game.apply(1, game.choose_ai())
        else:
            game.timeout(0)
        deadline += 30.0
        timed_turn = int(game.state.turn)
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
    info.text += t(" · Доход поля: +%d", " · Board income: +%d") % int(view.get("income_bonus", 0))
    sweep_button.visible = selected_unit >= 0
    sweep_button.disabled = true
    for action in view.legal:
        if action.type == "attack" and int(action.source) == selected_unit:
            sweep_button.disabled = false
    rotation_left.disabled = selected_hand < 0 or int(view.active) != 0 or int(view.winner) != -1 or int(view.get("placed_cell", -1)) >= 0
    rotation_right.disabled = rotation_left.disabled
    end_turn_button.disabled = int(view.active) != 0 or int(view.winner) != -1 or (online and not lan.pending.is_empty())
    aim_label.text = t("Поворот перед размещением", "Rotate before placement")
    if selected_hand >= 0 and selected_hand < view.hand.size():
        var selected: Dictionary = game.card(int(view.hand[selected_hand]))
        aim_label.text = t(Core.TYPES_RU[int(selected.role)], Core.TYPES_EN[int(selected.role)]) + " · " + Feedback.pattern(selected, selected_direction)
    elif selected_unit >= 0 and view.board[selected_unit] != null:
        var selected: Dictionary = game.card(int(view.board[selected_unit].id))
        aim_label.text = Feedback.pattern(selected, int(view.board[selected_unit].direction)) + t(" · атака: %d мон.", " · attack: %d coin") % (0 if selected_unit == int(view.placed_cell) else 1)
    var legal: Array = view.legal
    for i in range(9):
        var unit: Variant = view.board[i]
        var b: Button = board_buttons[i]
        b.modulate = Color.WHITE
        var element: int = int(view.terrain[i])
        var terrain_name: String = t(Core.ELEMENTS_RU[element], Core.ELEMENTS_EN[element])
        var style: StyleBoxFlat = b.get_theme_stylebox("normal").duplicate() as StyleBoxFlat
        style.bg_color = COLORS[element].darkened(0.78)
        style.border_color = COLORS[element].darkened(0.15)
        style.set_border_width_all(2)
        b.add_theme_font_size_override("font_size", 16)
        b.disabled = i == 4 and not bool(view.center_unlocked)
        if unit == null:
            b.text = terrain_name + "\n" + t("Свободно", "Empty")
            if i == 4:
                if b.disabled:
                    b.text = t("ЗАКРЫТО", "LOCKED") + " · " + terrain_name + t("\n5 юнитов ИЛИ ход 7\nСейчас: %d/5 · ход %d/7", "\n5 units OR turn 7\nNow: %d/5 · turn %d/7") % [int(view.scores[0]) + int(view.scores[1]), mini(int(view.turn), 7)]
                    style.bg_color = Color("252733")
                    style.border_color = Color("636778")
                else:
                    b.text = terrain_name + t("\nЦЕНТР ОТКРЫТ", "\nCENTER OPEN")
                    style.border_color = Color("a2ffe0")
                    style.set_border_width_all(4)
            if selected_hand >= 0 and selected_hand < view.hand.size() and int(game.card(int(view.hand[selected_hand])).element) == element and not b.disabled:
                b.text += "\n+1 HP"
        else:
            var def: Dictionary = game.card(int(unit.id))
            b.text = (t("ТВОЙ", "YOURS") if unit.owner == 0 else t("ВРАГ", "ENEMY")) + " · " + terrain_name + "\n" + str(def[language])
            b.text += "\n⚔ %d   ♥ %d" % [unit.attack, unit.health] + (" +1" if int(unit.get("terrain_bonus", 0)) == 1 else "")
            b.text += "\n" + Feedback.pattern(def, int(unit.direction))
            b.tooltip_text = str(def[language]) + " · " + terrain_name + t(" · здоровье учитывает бонус клетки", " · health includes terrain bonus")
            style.border_color = Color("70c5ff") if int(unit.owner) == 0 else Color("ff8b87")
        var highlight: bool = false
        for c in legal:
            if (c.type == "play" and selected_hand >= 0 and c.hand == selected_hand and c.cell == i) or (c.type == "attack" and selected_unit >= 0 and c.source == selected_unit and c.target == i):
                highlight = true
        if highlight:
            style.border_color = Color("ffb38f") if selected_unit >= 0 and unit != null and int(unit.owner) == 0 else Color("a4ffc3")
            style.set_border_width_all(5)
        elif i == selected_unit:
            style.border_color = Color.WHITE
            style.set_border_width_all(5)
        for theme_state in ["normal", "hover", "pressed", "disabled"]:
            b.add_theme_stylebox_override(theme_state, style)
        b.add_theme_color_override("font_disabled_color", Color("c8c8d0"))
    if bool(view.center_unlocked) and not last_center_open:
        Feedback.show_unlock(board_buttons[4], t("ЦЕНТР ОТКРЫТ", "CENTER OPEN"))
        center_unlock_effects += 1
    last_center_open = bool(view.center_unlocked)
    for child in hand_row.get_children():
        hand_row.remove_child(child)
        child.queue_free()
    for i in range(view.hand.size()):
        var def: Dictionary = game.card(int(view.hand[i]))
        var orientation: int = selected_direction if i == selected_hand else 0
        var b: Button = button(str(def[language]) + "\n" + t(Core.ELEMENTS_RU[int(def.element)], Core.ELEMENTS_EN[int(def.element)]) + " · " + t(Core.TYPES_RU[int(def.role)], Core.TYPES_EN[int(def.role)]) + "\n◉ %d  ⚔ %d  ♥ %d\n" % [def.cost, def.attack, def.health] + Feedback.pattern(def, orientation), on_hand.bind(i), 146)
        b.add_theme_font_size_override("font_size", 17)
        b.custom_minimum_size.x = 170
        b.disabled = view.active != 0 or view.winner != -1 or int(view.get("placed_cell", -1)) >= 0 or int(def.cost) > int(view.coins) or (online and not lan.pending.is_empty())
        UIStyle.hand_card(b, COLORS[int(def.element)], i == selected_hand)
        b.tooltip_text = str(def[language]) + " · " + t(Core.TYPES_RU[int(def.role)], Core.TYPES_EN[int(def.role)])
        hand_row.add_child(b)
    message.modulate = Color.WHITE
    if tutorial and is_instance_valid(tutorial_hint):
        var hints: Array = [["Выбери доступную карту в руке. Число ◉ — её стоимость.", "Choose an affordable card in your hand. ◉ shows its cost."], ["Поверни карту кнопками ↶ ↷, затем коснись свободной подсвеченной клетки.", "Rotate the card with ↶ ↷, then tap a highlighted empty cell."], ["После размещения выбери атакующего или закончи ход. Новый юнит атакует бесплатно; прежний — за 1 монету. Союзникам тоже можно нанести урон.", "After placement, choose an attacker or end the turn. New unit attacks free; an older unit costs 1 coin. Allies can be damaged."]]
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
        message.text = t("Ударит ВСЕ подсвеченные цели. Оранжевые — союзники! Нажми АТАКОВАТЬ или любую цель.", "Hits ALL highlighted targets. Orange means ally! Press ATTACK or tap any target.")
    elif int(view.get("placed_cell", -1)) >= 0:
        message.text = t("Карта выставлена. Выбери нового юнита (бесплатно), прежнего (1 монета) или закончи ход.", "Card placed. Attack with the new unit (free), an older unit (1 coin), or end the turn.")
    else:
        message.text = t("Выбери карту или своего юнита", "Choose a card or your unit")

    animate_damage(view)

func rotate_card(step: int) -> void:
    var view: Dictionary = _view()
    if not battle or selected_hand < 0 or view.is_empty() or int(view.active) != 0 or int(view.winner) != -1 or int(view.get("placed_cell", -1)) >= 0:
        return
    selected_direction = posmod(selected_direction + step, 4)
    refresh()

func confirm_friendly_attack() -> void:
    if friendly_pending.is_empty():
        return
    var command: Dictionary = friendly_pending.duplicate()
    friendly_pending = {}
    if is_instance_valid(friendly_confirm):
        friendly_confirm.hide()
    act(command)

func animate_damage(view: Dictionary) -> void:
    var event_id: int = int(view.get("event_id", -1))
    if event_id <= last_animated_event:
        return
    last_animated_event = event_id
    for event in view.get("events", []):
        if event.get("type") == "damage":
            var cell: int = int(event.cell)
            if cell >= 0 and cell < board_buttons.size():
                if int(event.get("wave", 0)) == 0:
                    Feedback.show_damage(board_buttons[cell], int(event.amount))
                else:
                    var delay := board_buttons[cell].create_tween()
                    delay.tween_interval(0.32)
                    delay.tween_callback(Feedback.show_damage.bind(board_buttons[cell], int(event.amount)))
                damage_effects_total += 1

func show_card_guide() -> void:
    battle = false
    tutorial = false
    online = false
    lan.stop()
    clear_screen()
    root.add_child(label(t("КАРТЫ И ПРАВИЛА", "CARDS AND RULES"), 28))
    root.add_child(label(t("Стихия юнита совпала с клеткой: +1 HP. Центр открывается при 5 юнитах или на ходу 7. Пороги 4/6 юнитов дают +1/+2 дохода с последующих ходов. Второму игроку +1 монета в первый ход.", "Matching terrain gives +1 HP. Center opens at five units or turn seven. Four/six units unlock +1/+2 income from subsequent turns. Second player gets +1 opening coin."), 18))
    var scroll := ScrollContainer.new()
    scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
    root.add_child(scroll)
    var list := VBoxContainer.new()
    list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    list.add_theme_constant_override("separation", 10)
    scroll.add_child(list)
    var descriptions: Array = [
        ["Боец: соседняя клетка впереди.", "Fighter: one cell forward."],
        ["Страж: вперёд и в обе стороны, много здоровья.", "Guard: forward and both flanks, high health."],
        ["Копейщик: до двух клеток вперёд, первый юнит закрывает следующего.", "Lancer: up to two cells forward; the first unit blocks the next."],
        ["Стрелок: до двух клеток вперёд, стреляет через стоящего между ними юнита.", "Archer: up to two cells forward; can fire over an intervening unit."],
        ["Фланкер: две передние диагонали.", "Flanker: the two forward diagonals."]]
    for description in descriptions:
        list.add_child(label(t(description[0], description[1]), 18))
    list.add_child(label(t("АТАКА бьёт всех по стрелкам одновременно, включая союзников. Сначала бьёт активный юнит; погибшие не отвечают. Только выжившие враги с подходящим направлением отвечают атакующему. Урон своим требует подтверждения. Пороги дохода и центр после открытия не закрываются.", "ATTACK hits all targets in the firing arcs, including allies. Active unit strikes first; dead enemies cannot retaliate. Only surviving enemies facing the attacker counter. Friendly fire requires confirmation. Income thresholds and center unlock are permanent."), 18))
    for id in range(Core.CARD_COUNT):
        var definition: Dictionary = game.card(id)
        var text: String = str(definition[language]) + " · " + t(Core.ELEMENTS_RU[int(definition.element)], Core.ELEMENTS_EN[int(definition.element)]) + " · " + t(Core.TYPES_RU[int(definition.role)], Core.TYPES_EN[int(definition.role)])
        text += "\n◉ %d  ⚔ %d  ♥ %d  " % [definition.cost, definition.attack, definition.health] + Feedback.pattern(definition, 0)
        list.add_child(label(text, 18))
    root.add_child(button(t("В МЕНЮ", "MENU"), show_menu))

func reason_text(reason: String) -> String:
    var texts: Dictionary = {"five": ["занято 5 клеток", "five cells occupied"], "empty": ["закончились карты", "no cards left"], "timeout": ["два пропущенных хода", "two missed turns"], "limit": ["истекло время матча", "match time limit"], "disconnect": ["соперник не вернулся", "opponent did not return"], "resigned": ["игрок вышел", "player left"]}
    if texts.has(reason):
        return t(texts[reason][0], texts[reason][1])
    return reason

func _focus_connection_start(reference: WeakRef) -> void:
    # Text wrapping can settle over several container layouts. Focus only the live page.
    await get_tree().process_frame
    await get_tree().process_frame
    var control: Variant = reference.get_ref()
    if control == null or not network_page or online or not control.is_inside_tree() or control.is_queued_for_deletion() or not root.is_ancestor_of(control):
        return
    control.grab_focus()
    var page: Node = root.get_parent()
    if page is ScrollContainer:
        page.set_deferred("scroll_vertical", 0)
func remember_invitation() -> void:
    if not is_instance_valid(invite_input) or not invite_input.is_inside_tree():
        return
    var text: String = invite_input.text
    if text.length() <= 2048:
        invitation_drafts["bluetooth" if bluetooth_mode else "lan"] = text
    if is_instance_valid(connection_join_button) and connection_join_button.is_inside_tree():
        connection_join_button.disabled = text.strip_edges().is_empty() or text.length() > 2048 or (bluetooth_mode and is_instance_valid(bluetooth_devices) and bluetooth_devices.item_count == 0)
    if text.length() > 2048:
        _show_network_status("invite_too_long", true)

func paste_invitation() -> void:
    var text: String = DisplayServer.clipboard_get()
    if text.length() > 2048:
        _show_network_status("invite_too_long", true)
        return
    invite_input.text = text
    remember_invitation()

func _show_network_status(code: String, error: bool = false) -> void:
    if not is_instance_valid(lobby_status) or not lobby_status.is_inside_tree():
        return
    lobby_status.text = network_error(code)
    lobby_status.modulate = Color("ffcbc2") if error else Color.WHITE
    if error:
        var parent: Node = root.get_parent()
        if parent is ScrollContainer:
            call_deferred("_reveal_network_status", weakref(lobby_status))

func _reveal_network_status(reference: WeakRef) -> void:
    var control: Variant = reference.get_ref()
    if control == null or control != lobby_status or not control.is_inside_tree() or control.is_queued_for_deletion():
        return
    var parent: Node = root.get_parent()
    if parent is ScrollContainer and parent.is_inside_tree() and not parent.is_queued_for_deletion():
        parent.ensure_control_visible(control)
func edit_network_deck() -> void:
    remember_invitation()
    connection_return_mode = "bluetooth" if bluetooth_mode else "lan"
    show_collection()

func return_from_collection() -> void:
    var previous: String = connection_return_mode
    connection_return_mode = ""
    if previous == "bluetooth":
        show_bluetooth_menu()
    elif previous == "lan":
        show_lan_menu()
    else:
        show_menu()

func cancel_connection() -> void:
    var use_bluetooth: bool = bluetooth_mode
    if online:
        lan.leave()
    online = false
    if use_bluetooth:
        show_bluetooth_menu()
    else:
        show_lan_menu()

func request_close_room() -> void:
    var confirmation := ConfirmationDialog.new()
    confirmation.name = "CloseRoomPrompt"
    confirmation.title = t("Закрыть комнату?", "Close the room?")
    confirmation.dialog_text = t("Приглашение перестанет работать. Другому игроку понадобится новое.", "This invitation will stop working. The other player will need a new one.")
    confirmation.dialog_autowrap = true
    confirmation.ok_button_text = t("Закрыть", "Close")
    confirmation.cancel_button_text = t("Оставить", "Keep open")
    confirmation.confirmed.connect(cancel_connection)
    confirmation.canceled.connect(confirmation.queue_free)
    add_child(confirmation)
    UIStyle.decorate_dialog(confirmation)
    confirmation.popup_centered_clamped(Vector2i(520,240),0.9)
func show_lan_menu() -> void:
    remember_invitation()
    _switch_transport(false)
    lan.stop()
    online = false
    network_page = true
    battle = false
    tutorial = false
    clear_screen()
    preload("res://src/connection_screen.gd").build(self, false)

func _network_deck_summary() -> void:
    var state: Dictionary = profile.state()
    var meta: Dictionary = state.get("collection", {})
    var name: String = str(meta.get("names", {}).get(meta.get("selected", ""), t("не выбрана", "not selected")))
    var choose: Button = button(t("КОЛОДА: ", "DECK: ") + name, edit_network_deck, 58)
    choose.name = "NetworkDeck"
    root.add_child(choose)

func _network_deck() -> Dictionary:
    if not profile.enabled:
        return {"ok": true, "ids": Core.STARTER.duplicate()}
    if not ensure_collection():
        return {"ok": false, "error": "invalid_deck"}
    var selected: Dictionary = Collection.selected(profile.state())
    return selected if selected.ok else {"ok": false, "error": "invalid_deck"}

func create_lan_room(address: String = "", port: int = 17844) -> Dictionary:
    var selected: Dictionary = _network_deck()
    if not selected.ok:
        if is_instance_valid(lobby_status):
            _show_network_status("invalid_deck", true)
        return selected
    online = true
    battle = false
    displayed_revision = -1
    local_match_id = Crypto.new().generate_random_bytes(16).hex_encode()
    result_saved = false
    var result: Dictionary = lan.host_room(address, port, 0, selected.ids)
    if not result.ok:
        online = false
        if is_instance_valid(lobby_status):
            _show_network_status(str(result.error), true)
        return result
    clear_screen()
    preload("res://src/scrollable_page.gd").wrap(root)
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
    root.add_child(button(t("ЗАКРЫТЬ КОМНАТУ", "CLOSE ROOM"), request_close_room))
    return result

func join_lan_room(text: String) -> Dictionary:
    if text.length() > 2048:
        _show_network_status("invite_too_long", true)
        return {"ok": false, "error": "invite_too_long"}
    invitation_drafts["bluetooth" if bluetooth_mode else "lan"] = text
    var selected: Dictionary = _network_deck()
    if not selected.ok:
        if is_instance_valid(lobby_status):
            _show_network_status("invalid_deck", true)
        return selected
    online = true
    battle = false
    displayed_revision = -1
    local_match_id = Crypto.new().generate_random_bytes(16).hex_encode()
    result_saved = false
    var result: Dictionary = lan.join_room(text, selected.ids)
    if not result.ok:
        online = false
        if is_instance_valid(lobby_status):
            _show_network_status(str(result.error), true)
        return result
    clear_screen()
    preload("res://src/scrollable_page.gd").wrap(root)
    root.add_child(label(t("ПОДКЛЮЧЕНИЕ", "CONNECTING"), 30))
    lobby_status = label(t("Проверяем комнату и защищённое соединение…", "Checking the room and secure connection…"), 20)
    lobby_status.name = "ConnectionStatus"
    root.add_child(lobby_status)
    connection_retry_button = button(t("ПРОВЕРИТЬ ПРИГЛАШЕНИЕ И ПОВТОРИТЬ", "REVIEW INVITATION AND RETRY"), cancel_connection)
    connection_retry_button.name = "ConnectionRetry"
    connection_retry_button.visible = false
    root.add_child(connection_retry_button)
    var cancel: Button = button(t("ОТМЕНА", "CANCEL"), cancel_connection)
    cancel.name = "CancelConnection"
    root.add_child(cancel)
    _network_status(lan.connection_status)
    return result

func network_error(value: String) -> String:
    var messages: Dictionary = {"invalid_deck": ["Выбери полную колоду в разделе коллекции.", "Select a complete deck in your collection."], "deck_changed": ["Колоду начатого матча менять нельзя.", "The deck cannot change after the match starts."], "no_local_address": ["Подключись к Wi-Fi и попробуй снова.", "Connect to Wi-Fi and try again."], "port_busy": ["Порт комнаты занят. Закрой другую комнату.", "Room port is busy. Close the other room."], "invalid_invite": ["Приглашение повреждено или неполное.", "Invitation is invalid or incomplete."], "incompatible_or_nonlocal_invite": ["Нужна совместимая версия и приглашение из локальной сети.", "A compatible version and local-network invitation are required."], "certificate_mismatch": ["Сертификат комнаты не совпал. Подключение остановлено.", "Room certificate mismatch. Connection stopped."], "connection_failed": ["Не удалось подключиться. Проверь сеть и приглашение.", "Connection failed. Check the network and invitation."], "connection_lost": ["Связь не восстановлена. Вернись в меню.", "Connection could not be restored. Return to the menu."], "reconnecting": ["Восстанавливаем соединение…", "Reconnecting…"], "waiting_reconnect": ["Ожидаем возвращения соперника…", "Waiting for the opponent to reconnect…"]}
    messages.merge({"android_bluetooth_required": ["Bluetooth доступен в Android-клиенте.", "Bluetooth is available in the Android client."], "bluetooth_permission_required": ["Разреши доступ к устройствам поблизости и обнови список.", "Allow nearby-device access and refresh the list."], "bluetooth_disabled": ["Включи Bluetooth в настройках Android.", "Enable Bluetooth in Android settings."], "select_paired_device": ["Выбери ранее сопряжённое устройство.", "Select an already paired device."], "pair_device_in_android_settings": ["Сначала сопряги устройства в настройках Android.", "Pair the devices in Android settings first."], "secure_connect_failed": ["Защищённое соединение не установлено. Проверь сопряжение и комнату.", "Secure connection failed. Check pairing and the room."]})
    messages.merge({"invite_too_long": ["Приглашение слишком длинное. Вставьте только ссылку комнаты.", "Invitation is too long. Paste only the room link."], "connecting": ["Подключаемся к комнате…", "Connecting to the room…"], "connected": ["Соединение установлено", "Connected"], "waiting_guest": ["Ожидаем второго игрока…", "Waiting for the other player…"], "idle": ["Готово к подключению", "Ready to connect"]})
    return t(messages[value][0], messages[value][1]) if messages.has(value) else value

func _network_status(status: String) -> void:
    if not online:
        return
    var error: bool = status not in ["connected", "waiting_guest", "idle", "connecting", "reconnecting", "waiting_reconnect"]
    _show_network_status(status, error)
    if is_instance_valid(connection_retry_button) and connection_retry_button.is_inside_tree():
        connection_retry_button.visible = error
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
        _save_network_result(view)

func _save_network_result(view: Dictionary) -> void:
    if not online or result_saved or int(view.get("winner", -1)) == -1 or not profile.enabled:
        return
    if local_match_id == "":
        return
    if profile.state().get("lastMatch", {}).get("replay", {}).get("session", "") == local_match_id:
        result_saved = true
        return
    var winner: int = int(view.winner)
    if winner not in [0, 1, 2]:
        return
    var outcome: String = "win" if winner == 0 else ("draw" if winner == 2 else "loss")
    var summary: Dictionary = {"version": 2, "session": local_match_id, "rules": Core.RULES_ID, "scope": "public_result_only", "transport": "bluetooth" if bluetooth_mode else "lan", "commands": [], "result": str(view.get("reason", ""))}
    result_saved = _commit_finished_result(outcome, summary)
    if not result_saved and is_instance_valid(message):
        message.text += t(" · не удалось сохранить результат", " · result could not be saved")

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
    remember_invitation()
    _switch_transport(true)
    online = false
    battle = false
    tutorial = false
    network_page = true
    clear_screen()
    preload("res://src/connection_screen.gd").build(self, true)

func start_tutorial() -> void:
    start_match(true)
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
