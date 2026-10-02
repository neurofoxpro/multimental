extends RefCounted
## Battle composition/presentation. The scene host alone dispatches domain commands.
const Style = preload("res://src/ui_theme.gd")
const Intent = preload("res://src/battle_interaction.gd")
const Feedback = preload("res://src/combat_feedback.gd")
static func build(ui) -> void:
    ui.clear_screen()
    ui.root.add_theme_constant_override("separation",8)
    var heading := HBoxContainer.new()
    var title: Label = ui.label(ui.t("ДУЭЛЬ", "DUEL"),16)
    title.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
    title.autowrap_mode = TextServer.AUTOWRAP_OFF
    title.add_theme_color_override("font_color",Style.ACCENT)
    heading.add_child(title)
    ui.timer_text = ui.label("",16)
    ui.timer_text.name = "TurnTimer"
    ui.timer_text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    ui.timer_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
    heading.add_child(ui.timer_text)
    ui.root.add_child(heading)
    ui.info = ui.label("",22)
    ui.info.name = "BattleSummary"
    ui.root.add_child(ui.info)
    var layout = preload("res://src/battle_layout.gd").new()
    ui.root.add_child(layout)
    layout.setup()
    var grid := GridContainer.new()
    grid.columns = 3
    grid.add_theme_constant_override("h_separation",8)
    grid.add_theme_constant_override("v_separation",8)
    layout.board.add_child(grid)
    for index in range(9):
        var cell = preload("res://src/battle_tile.gd").new()
        cell.setup(ui,index)
        grid.add_child(cell)
        ui.board_buttons.append(cell)
    ui.message = ui.label("",18)
    ui.message.name = "BattleMessage"
    ui.message.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
    ui.message.custom_minimum_size.y = 46
    ui.message.max_lines_visible = 2
    layout.panel.add_child(ui.message)
    var actions := HBoxContainer.new()
    actions.name = "BattleSelectionActions"
    actions.custom_minimum_size.y = 58
    actions.add_theme_constant_override("separation",6)
    layout.panel.add_child(actions)
    ui.rotation_left = ui.button("↶",ui.rotate_card.bind(-1),58)
    ui.rotation_left.name = "RotateLeft"
    ui.rotation_left.tooltip_text = ui.t("Повернуть карту влево", "Rotate card left")
    ui.rotation_left.custom_minimum_size.x = 54
    ui.rotation_left.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
    actions.add_child(ui.rotation_left)
    ui.aim_label = ui.label("",16)
    ui.aim_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    actions.add_child(ui.aim_label)
    ui.rotation_right = ui.button("↷",ui.rotate_card.bind(1),58)
    ui.rotation_right.name = "RotateRight"
    ui.rotation_right.tooltip_text = ui.t("Повернуть карту вправо", "Rotate card right")
    ui.rotation_right.custom_minimum_size.x = 54
    ui.rotation_right.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
    actions.add_child(ui.rotation_right)
    ui.sweep_button = ui.button("",ui.attack_selected,58)
    ui.sweep_button.name = "SweepAttack"
    Style.decorate_button(ui.sweep_button,true)
    actions.add_child(ui.sweep_button)
    var cancel: Button = ui.button(ui.t("ОТМЕНА", "CANCEL"),ui.cancel_battle_selection,58)
    cancel.name = "CancelSelection"
    cancel.custom_minimum_size.x = 94
    cancel.size_flags_horizontal = Control.SIZE_SHRINK_END
    actions.add_child(cancel)
    ui.tutorial_hint = null
    if ui.tutorial:
        ui.tutorial_hint = ui.label("",16)
        ui.tutorial_hint.max_lines_visible = 3
        layout.panel.add_child(ui.tutorial_hint)
    var hand_caption := HBoxContainer.new()
    var hand_title: Label = ui.label(ui.t("ВАША РУКА", "YOUR HAND"),15)
    hand_title.autowrap_mode = TextServer.AUTOWRAP_OFF
    hand_title.add_theme_color_override("font_color",Style.ACCENT)
    hand_caption.add_child(hand_title)
    var money: Label = ui.label("",17)
    money.name = "YourBattleResources"
    money.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
    money.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    hand_caption.add_child(money)
    layout.panel.add_child(hand_caption)
    var hand_scroll := ScrollContainer.new()
    hand_scroll.name = "HandScroll"
    hand_scroll.custom_minimum_size.y = 200
    hand_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
    hand_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
    hand_scroll.follow_focus = true
    layout.panel.add_child(hand_scroll)
    ui.hand_row = HBoxContainer.new()
    ui.hand_row.add_theme_constant_override("separation",8)
    hand_scroll.add_child(ui.hand_row)
    var footer := HBoxContainer.new()
    footer.name = "BattleFooter"
    footer.add_theme_constant_override("separation",12)
    ui.root.add_child(footer)
    var back: Button = ui.button(ui.t("МЕНЮ", "MENU"),ui.request_leave_match,62)
    back.name = "BattleBack"
    back.custom_minimum_size.x = 100
    back.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
    footer.add_child(back)
    ui.end_turn_button = ui.button(ui.t("ЗАКОНЧИТЬ ХОД", "END TURN"),ui.pass_turn,62)
    ui.end_turn_button.name = "EndTurn"
    Style.decorate_button(ui.end_turn_button,true)
    footer.add_child(ui.end_turn_button)
    ui.friendly_confirm = ConfirmationDialog.new()
    ui.friendly_confirm.title = ui.t("Удар заденет союзников", "Attack will hit allies")
    ui.friendly_confirm.ok_button_text = ui.t("Всё равно атаковать", "Attack anyway")
    ui.friendly_confirm.cancel_button_text = ui.t("Отмена", "Cancel")
    ui.friendly_confirm.dialog_autowrap = true
    ui.friendly_confirm.confirmed.connect(ui.confirm_friendly_attack)
    ui.friendly_confirm.canceled.connect(ui.cancel_friendly_attack)
    ui.add_child(ui.friendly_confirm)
    Style.decorate_dialog(ui.friendly_confirm)
    ui.leave_confirm = ConfirmationDialog.new()
    ui.leave_confirm.title = ui.t("Выйти из партии?", "Leave the match?")
    ui.leave_confirm.dialog_text = ui.t("Текущая партия будет прервана.", "The current match will be interrupted.")
    ui.leave_confirm.dialog_autowrap = true
    ui.leave_confirm.ok_button_text = ui.t("Выйти", "Leave")
    ui.leave_confirm.cancel_button_text = ui.t("Остаться", "Stay")
    ui.leave_confirm.confirmed.connect(ui.show_menu)
    ui.add_child(ui.leave_confirm)
    Style.decorate_dialog(ui.leave_confirm)
    ui.battle_inspector = preload("res://src/card_inspector.gd").new()
    ui.add_child(ui.battle_inspector)

static func render(ui, view: Dictionary) -> void:
    var pending: bool = ui.online and not ui.lan.pending.is_empty()
    var selected_card: bool = ui.selected_hand >= 0 and ui.selected_hand < view.hand.size()
    var selected_unit: bool = ui.selected_unit >= 0 and ui.selected_unit < view.board.size() and view.board[ui.selected_unit] != null
    var preview: Dictionary = Intent.attack(view,ui.selected_unit,pending)
    var opponent: String = ui.t("СОПЕРНИК", "OPPONENT") if ui.online else ui.t("ИИ", "AI")
    ui.info.text = ui.t("ВЫ %d/5     ·     %s %d/5", "YOU %d/5     ·     %s %d/5") % [view.scores[0],opponent,view.scores[1]]
    ui.info.tooltip_text = ui.t("Побеждает тот, кто займёт пять клеток", "Occupy five cells to win")
    var remaining: int = ui.lan.remaining_seconds() if ui.online else maxi(0,int(ceil(ui.deadline-Time.get_unix_time_from_system())))
    ui.timer_text.text = ui.t("Ход %d · %d с", "Turn %d · %d s") % [view.turn,remaining]
    var resources: Label = ui.find_child("YourBattleResources",true,false)
    resources.text = "◉ %d  ·  " % view.coins + ui.t("В колоде %d", "Deck %d") % view.deck_count
    resources.tooltip_text = ui.t("Боевые монеты · доход поля +%d · карт в руке соперника %d", "Battle coins · board income +%d · opponent hand %d") % [int(view.get("income_bonus",0)),int(view.opponent_hand_count)]
    ui.rotation_left.visible = selected_card
    ui.rotation_right.visible = selected_card
    ui.rotation_left.disabled = not selected_card or not Intent.available(view,pending) or int(view.placed_cell) >= 0
    ui.rotation_right.disabled = ui.rotation_left.disabled
    ui.sweep_button.visible = selected_unit
    ui.sweep_button.disabled = preview.command.is_empty()
    ui.sweep_button.text = ui.t("АТАКОВАТЬ · ◉ %d", "ATTACK · ◉ %d") % preview.cost
    ui.sweep_button.tooltip_text = ui.t("Удар по всем показанным направлениям. Союзников: %d.", "Attack along every shown direction. Allies: %d.") % preview.allies
    ui.aim_label.visible = not selected_unit
    ui.aim_label.text = ui.t("Выбор не расходует ход", "Selection does not spend your turn")
    if selected_card:
        ui.aim_label.text = Feedback.pattern(ui.game.card(int(view.hand[ui.selected_hand])),ui.selected_direction)
    var cancel: Button = ui.find_child("CancelSelection",true,false)
    cancel.visible = selected_card or selected_unit
    ui.end_turn_button.disabled = not Intent.available(view,pending)
    Style.decorate_button(ui.end_turn_button,not selected_card and not selected_unit)
    for index in range(9):
        ui.board_buttons[index].present(ui,view,index,preview.targets,not preview.command.is_empty())
    # Keep slot identity, focus, and the horizontal scroll position on presentation-only refresh.
    while ui.hand_row.get_child_count() > view.hand.size():
        var old: Node = ui.hand_row.get_child(ui.hand_row.get_child_count()-1)
        ui.hand_row.remove_child(old)
        old.queue_free()
    for index in range(view.hand.size()):
        if index >= ui.hand_row.get_child_count():
            var fresh = preload("res://src/battle_hand_card.gd").new()
            fresh.setup(ui,index)
            ui.hand_row.add_child(fresh)
        var item = ui.hand_row.get_child(index)
        item.present(ui,ui.game.card(int(view.hand[index])),ui.selected_direction if ui.selected_hand == index else 0,ui.selected_hand == index,Intent.reason(view,index,pending))
    ui.message.modulate = Color.WHITE
    if int(view.winner) != -1:
        ui.message.text = ui.t("ПОБЕДА", "VICTORY") if int(view.winner) == 0 else (ui.t("НИЧЬЯ", "DRAW") if int(view.winner) == 2 else ui.t("ПОРАЖЕНИЕ", "DEFEAT"))
        ui.message.text += " · " + ui.reason_text(str(view.reason))
    elif pending:
        ui.message.text = ui.t("Ход отправлен. Ожидаем подтверждения…", "Move sent. Waiting for acknowledgement…")
    elif view.get("phase") == "reconnecting":
        ui.message.text = ui.t("Восстанавливаем соединение. Осмотр доступен.", "Reconnecting. Card details remain available.")
    elif int(view.active) != 0:
        ui.message.text = ui.t("Ход соперника. Можно изучить карты и поле.", "Opponent's turn. Inspect your cards and the board.")
    elif selected_card:
        var card: Dictionary = ui.game.card(int(view.hand[ui.selected_hand]))
        ui.message.text = str(card[ui.language]) + ui.t(" · ◉ %d\nПоверните при необходимости и коснитесь клетки.", " · ◉ %d\nRotate if needed, then tap an available cell.") % card.cost
    elif selected_unit:
        var card: Dictionary = ui.game.card(int(view.board[ui.selected_unit].id))
        ui.message.text = str(card[ui.language]) + " · " + (ui.t("нет доступной атаки", "no available attack") if preview.command.is_empty() else ui.t("врагов %d · союзников %d", "enemies %d · allies %d") % [preview.enemies,preview.allies])
        ui.message.text += ui.t("\nСмена фигуры не атакует. Подтвердите кнопкой.", "\nChanging selection does not attack. Use the button.")
    elif int(view.placed_cell) >= 0:
        ui.message.text = ui.t("Карта размещена. Выберите юнита для атаки или закончите ход.", "Card deployed. Select a unit to attack, or end the turn.")
    else:
        ui.message.text = ui.t("Ваш ход: выберите карту для размещения или своего юнита.", "Your turn: select a card to deploy, or one of your units.")
    if ui.tutorial and is_instance_valid(ui.tutorial_hint):
        ui.tutorial_hint.text = ui.t("Карта → клетка. Фигура → АТАКА. Описание — кнопкой на карте.", "Card → cell. Unit → ATTACK. Use the details button to inspect.")
