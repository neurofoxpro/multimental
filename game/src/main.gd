extends Control
const Core = preload("res://src/match_core.gd")
const COLORS: Array[Color] = [Color("e76f51"), Color("4ea8de"), Color("f6ce55"), Color("9cdbd3"), Color("ab9366")]
var game = Core.new()
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

func t(ru: String, en: String) -> String:
    return ru if language == "ru" else en

func _ready() -> void:
    RenderingServer.set_default_clear_color(Color("091322"))
    var cfg := ConfigFile.new()
    if cfg.load("user://settings.cfg") == OK:
        language = str(cfg.get_value("ui", "language", "ru"))
    show_menu()
    print("MULTIMENTAL_READY " + BuildInfo.VERSION)

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
    battle = false
    clear_screen()
    root.add_child(label("MULTIMENTAL", 36))
    root.add_child(label(t("Играбельная альфа · 5 стихий · поле 3×3", "Playable alpha · 5 elements · 3×3 board"), 18))
    var space := Control.new()
    space.size_flags_vertical = Control.SIZE_EXPAND_FILL
    root.add_child(space)
    root.add_child(button(t("ИГРАТЬ ПРОТИВ ИИ", "PLAY AGAINST AI"), start_match, 86))
    root.add_child(label(t("Одна карта или одна атака за ход.\nЗайми 5 клеток. Атаки — по соседним клеткам.\nМонеты восстанавливаются каждый ход.", "One card or attack per turn.\nOccupy 5 cells. Attack adjacent enemies.\nCoins refill each turn."), 20))
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
    selected_hand = index
    selected_unit = -1
    refresh()

func on_cell(index: int) -> void:
    if game.state.winner != -1 or game.state.active != 0:
        return
    if selected_hand >= 0:
        act({"type": "play", "hand": selected_hand, "cell": index})
    elif selected_unit >= 0 and game.state.board[index] != null and game.state.board[index].owner == 1:
        act({"type": "attack", "source": selected_unit, "target": index})
    elif game.state.board[index] != null and game.state.board[index].owner == 0:
        selected_unit = index
        selected_hand = -1
        refresh()
    else:
        message.text = t("Выбери карту в руке или своего юнита.", "Select a card or your unit first.")

func act(command: Dictionary) -> void:
    var result: Dictionary = game.apply(0, command)
    if not result.ok:
        message.text = t("Недопустимая цель или недостаточно монет.", "Invalid target or insufficient coins.")
        message.modulate = Color("ff8585")
        return
    after_action()

func pass_turn() -> void:
    if game.state.active == 0 and game.state.winner == -1:
        act({"type": "pass"})

func after_action() -> void:
    selected_hand = -1
    selected_unit = -1
    deadline = Time.get_unix_time_from_system() + 30.0
    bot_due = Time.get_unix_time_from_system() + 0.65
    refresh()
    if game.state.winner != -1:
        var file := FileAccess.open("user://last-match.json", FileAccess.WRITE)
        if file != null:
            file.store_string(JSON.stringify({"version": 1, "seed": game.initial_seed, "commands": game.commands, "result": game.state.reason}))
        print("MULTIMENTAL_MATCH_FINISHED " + str(game.state.winner))

func _process(_delta: float) -> void:
    if not battle or game.state.winner != -1:
        return
    var now: float = Time.get_unix_time_from_system()
    if now >= match_end:
        game.end_on_time_limit()
        after_action()
        return
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
    var second: int = maxi(0, int(ceil(deadline - now)))
    if second != last_second:
        last_second = second
        timer_text.text = t("Ход %d · осталось %d с", "Turn %d · %d s remaining") % [game.state.turn, second]

func refresh() -> void:
    if not battle:
        return
    var me: Dictionary = game.state.players[0]
    var them: Dictionary = game.state.players[1]
    info.text = t("Ты: %d/5 · ИИ: %d/5\nМонеты: %d · Колода: %d · Рука ИИ: %d", "You: %d/5 · AI: %d/5\nCoins: %d · Deck: %d · AI hand: %d") % [game.count_cells(0), game.count_cells(1), me.coins, me.deck.size(), them.hand.size()]
    var legal: Array[Dictionary] = game.legal(0)
    for i in range(9):
        var unit: Variant = game.state.board[i]
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
    for i in range(me.hand.size()):
        var def: Dictionary = game.card(int(me.hand[i]))
        var b: Button = button(str(def[language]) + "\n◉ %d\n⚔ %d   ♥ %d" % [def.cost, def.attack, def.health], on_hand.bind(i), 116)
        b.custom_minimum_size.x = 134
        b.disabled = game.state.active != 0 or game.state.winner != -1 or int(def.cost) > int(me.coins)
        b.modulate = COLORS[int(def.element)] if i != selected_hand else Color.WHITE
        hand_row.add_child(b)
    message.modulate = Color.WHITE
    if game.state.winner != -1:
        message.text = t("ПОБЕДА", "VICTORY") if game.state.winner == 0 else (t("НИЧЬЯ", "DRAW") if game.state.winner == 2 else t("ПОРАЖЕНИЕ", "DEFEAT"))
        message.text += " · " + str(game.state.reason)
    elif game.state.active == 1:
        message.text = t("Ход ИИ…", "AI turn…")
    elif selected_hand >= 0:
        message.text = t("Выбери свободную подсвеченную клетку", "Choose a highlighted empty cell")
    elif selected_unit >= 0:
        message.text = t("Выбери соседнего врага для атаки", "Choose an adjacent enemy to attack")
    else:
        message.text = t("Выбери карту или своего юнита", "Choose a card or your unit")
