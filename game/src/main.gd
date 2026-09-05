extends Control

const ELEMENTS: Array[Dictionary] = [
    {"id": "fire", "ru": "Огонь", "en": "Fire", "short_ru": "ОГ", "short_en": "FI", "color": Color("d34b42")},
    {"id": "water", "ru": "Вода", "en": "Water", "short_ru": "ВД", "short_en": "WA", "color": Color("3478c9")},
    {"id": "lightning", "ru": "Молния", "en": "Lightning", "short_ru": "МЛ", "short_en": "LI", "color": Color("c6a62d")},
    {"id": "air", "ru": "Воздух", "en": "Air", "short_ru": "ВЗ", "short_en": "AI", "color": Color("69a8a5")},
    {"id": "earth", "ru": "Земля", "en": "Earth", "short_ru": "ЗМ", "short_en": "EA", "color": Color("7c643f")},
]

const TEXT: Dictionary = {
    "ru": {
        "subtitle": "Техническая альфа",
        "play": "НАЧАТЬ ТЕХНИЧЕСКИЙ МАТЧ",
        "cards": "КАРТЫ И КОЛОДЫ - СКОРО",
        "shop": "МАГАЗИН - СКОРО",
        "settings": "ЯЗЫК: РУССКИЙ",
        "hint": "Проверьте запуск, масштабирование и нажатия по клеткам.",
        "opponent": "ОППОНЕНТ",
        "player": "ИГРОК",
        "turn_player": "Ваш ход - выберите свободную клетку",
        "turn_opponent": "Ход тестового оппонента",
        "occupied": "Клетка уже занята",
        "win_player": "Проверка завершена: игрок занял 5 клеток",
        "win_opponent": "Проверка завершена: оппонент занял 5 клеток",
        "reset": "СБРОСИТЬ",
        "back": "В МЕНЮ",
        "board_hint": "Каждое нажатие размещает следующий элемент. После хода игрока тестовый оппонент автоматически занимает клетку.",
        "build": "Сборка",
    },
    "en": {
        "subtitle": "Technical alpha",
        "play": "START TECHNICAL MATCH",
        "cards": "CARDS AND DECKS - SOON",
        "shop": "STORE - SOON",
        "settings": "LANGUAGE: ENGLISH",
        "hint": "Verify startup, responsive layout and board taps.",
        "opponent": "OPPONENT",
        "player": "PLAYER",
        "turn_player": "Your turn - choose an empty cell",
        "turn_opponent": "Test opponent turn",
        "occupied": "This cell is already occupied",
        "win_player": "Check complete: player controls 5 cells",
        "win_opponent": "Check complete: opponent controls 5 cells",
        "reset": "RESET",
        "back": "BACK TO MENU",
        "board_hint": "Each tap places the next element. After your move, the test opponent automatically occupies a cell.",
        "build": "Build",
    },
}

var language: String = "ru"
var current_screen: String = "menu"
var move_index: int = 0
var match_finished: bool = false
var cell_owners: Array[int] = []
var cell_elements: Array[int] = []
var cell_buttons: Array[Button] = []
var player_count: int = 0
var opponent_count: int = 0

var content_root: VBoxContainer
var menu_panel: VBoxContainer
var battle_panel: VBoxContainer
var title_label: Label
var subtitle_label: Label
var version_label: Label
var language_button: Button
var play_button: Button
var cards_button: Button
var shop_button: Button
var menu_hint_label: Label
var opponent_label: Label
var player_label: Label
var status_label: Label
var board_hint_label: Label
var reset_button: Button
var back_button: Button
var board_grid: GridContainer

func _ready() -> void:
    set_process_unhandled_input(true)
    _build_interface()
    _reset_match()
    _refresh_text()
    resized.connect(_on_viewport_resized)
    call_deferred("_on_viewport_resized")

func _build_interface() -> void:
    var background := ColorRect.new()
    background.color = Color("071022")
    background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    add_child(background)

    var margin := MarginContainer.new()
    margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    margin.add_theme_constant_override("margin_left", 28)
    margin.add_theme_constant_override("margin_right", 28)
    margin.add_theme_constant_override("margin_top", 24)
    margin.add_theme_constant_override("margin_bottom", 24)
    add_child(margin)

    content_root = VBoxContainer.new()
    content_root.add_theme_constant_override("separation", 16)
    margin.add_child(content_root)

    var header := HBoxContainer.new()
    header.add_theme_constant_override("separation", 12)
    content_root.add_child(header)

    var title_box := VBoxContainer.new()
    title_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    header.add_child(title_box)

    title_label = Label.new()
    title_label.text = "MULTIMENTAL"
    title_label.add_theme_font_size_override("font_size", 38)
    title_label.add_theme_color_override("font_color", Color("f5f7ff"))
    title_box.add_child(title_label)

    subtitle_label = Label.new()
    subtitle_label.add_theme_font_size_override("font_size", 16)
    subtitle_label.add_theme_color_override("font_color", Color("8295c8"))
    title_box.add_child(subtitle_label)

    language_button = Button.new()
    language_button.custom_minimum_size = Vector2(140, 58)
    language_button.pressed.connect(_toggle_language)
    _apply_button_style(language_button, Color("17264a"), Color("2f467c"))
    header.add_child(language_button)

    var separator := HSeparator.new()
    separator.add_theme_constant_override("separation", 8)
    content_root.add_child(separator)

    menu_panel = VBoxContainer.new()
    menu_panel.size_flags_vertical = Control.SIZE_EXPAND_FILL
    menu_panel.alignment = BoxContainer.ALIGNMENT_CENTER
    menu_panel.add_theme_constant_override("separation", 16)
    content_root.add_child(menu_panel)

    var emblem := Label.new()
    emblem.text = "●  ◉  ✦  ◌  ◆"
    emblem.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    emblem.add_theme_font_size_override("font_size", 42)
    emblem.add_theme_color_override("font_color", Color("d7def7"))
    menu_panel.add_child(emblem)

    play_button = Button.new()
    play_button.custom_minimum_size = Vector2(0, 84)
    play_button.add_theme_font_size_override("font_size", 19)
    play_button.pressed.connect(_show_battle)
    _apply_button_style(play_button, Color("405fd0"), Color("5877ea"))
    menu_panel.add_child(play_button)

    cards_button = Button.new()
    cards_button.custom_minimum_size = Vector2(0, 64)
    cards_button.disabled = true
    _apply_button_style(cards_button, Color("14203c"), Color("14203c"))
    menu_panel.add_child(cards_button)

    shop_button = Button.new()
    shop_button.custom_minimum_size = Vector2(0, 64)
    shop_button.disabled = true
    _apply_button_style(shop_button, Color("14203c"), Color("14203c"))
    menu_panel.add_child(shop_button)

    menu_hint_label = Label.new()
    menu_hint_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    menu_hint_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    menu_hint_label.add_theme_font_size_override("font_size", 15)
    menu_hint_label.add_theme_color_override("font_color", Color("91a0c4"))
    menu_panel.add_child(menu_hint_label)

    battle_panel = VBoxContainer.new()
    battle_panel.visible = false
    battle_panel.size_flags_vertical = Control.SIZE_EXPAND_FILL
    battle_panel.add_theme_constant_override("separation", 12)
    content_root.add_child(battle_panel)

    opponent_label = Label.new()
    opponent_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    opponent_label.add_theme_font_size_override("font_size", 18)
    opponent_label.add_theme_color_override("font_color", Color("dc7180"))
    battle_panel.add_child(opponent_label)

    var board_aspect := AspectRatioContainer.new()
    board_aspect.ratio = 1.0
    board_aspect.stretch_mode = AspectRatioContainer.STRETCH_FIT
    board_aspect.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    board_aspect.size_flags_vertical = Control.SIZE_EXPAND_FILL
    battle_panel.add_child(board_aspect)

    board_grid = GridContainer.new()
    board_grid.columns = 3
    board_grid.add_theme_constant_override("h_separation", 10)
    board_grid.add_theme_constant_override("v_separation", 10)
    board_aspect.add_child(board_grid)

    for index in range(9):
        var cell := Button.new()
        cell.name = "Cell%d" % index
        cell.text = "·"
        cell.focus_mode = Control.FOCUS_NONE
        cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
        cell.size_flags_vertical = Control.SIZE_EXPAND_FILL
        cell.add_theme_font_size_override("font_size", 25)
        cell.pressed.connect(_on_cell_pressed.bind(index))
        _apply_cell_style(cell, Color("111d38"), Color("1b2e56"), Color("405681"))
        board_grid.add_child(cell)
        cell_buttons.append(cell)

    player_label = Label.new()
    player_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    player_label.add_theme_font_size_override("font_size", 18)
    player_label.add_theme_color_override("font_color", Color("79b7ff"))
    battle_panel.add_child(player_label)

    status_label = Label.new()
    status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    status_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    status_label.add_theme_font_size_override("font_size", 17)
    status_label.add_theme_color_override("font_color", Color("f1f4ff"))
    battle_panel.add_child(status_label)

    board_hint_label = Label.new()
    board_hint_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    board_hint_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    board_hint_label.add_theme_font_size_override("font_size", 13)
    board_hint_label.add_theme_color_override("font_color", Color("8290b4"))
    battle_panel.add_child(board_hint_label)

    var actions := HBoxContainer.new()
    actions.add_theme_constant_override("separation", 12)
    battle_panel.add_child(actions)

    reset_button = Button.new()
    reset_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    reset_button.custom_minimum_size = Vector2(0, 60)
    reset_button.pressed.connect(_reset_match)
    _apply_button_style(reset_button, Color("243254"), Color("34476f"))
    actions.add_child(reset_button)

    back_button = Button.new()
    back_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    back_button.custom_minimum_size = Vector2(0, 60)
    back_button.pressed.connect(_show_menu)
    _apply_button_style(back_button, Color("243254"), Color("34476f"))
    actions.add_child(back_button)

    version_label = Label.new()
    version_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    version_label.add_theme_font_size_override("font_size", 12)
    version_label.add_theme_color_override("font_color", Color("617092"))
    content_root.add_child(version_label)

func _apply_button_style(button: Button, normal_color: Color, hover_color: Color) -> void:
    var normal := StyleBoxFlat.new()
    normal.bg_color = normal_color
    normal.corner_radius_top_left = 12
    normal.corner_radius_top_right = 12
    normal.corner_radius_bottom_left = 12
    normal.corner_radius_bottom_right = 12
    normal.content_margin_left = 16
    normal.content_margin_right = 16
    button.add_theme_stylebox_override("normal", normal)

    var hover := normal.duplicate() as StyleBoxFlat
    hover.bg_color = hover_color
    button.add_theme_stylebox_override("hover", hover)
    button.add_theme_stylebox_override("pressed", hover)

    var disabled := normal.duplicate() as StyleBoxFlat
    disabled.bg_color = normal_color.darkened(0.25)
    button.add_theme_stylebox_override("disabled", disabled)
    button.add_theme_color_override("font_disabled_color", Color("59647d"))

func _apply_cell_style(button: Button, normal_color: Color, hover_color: Color, border_color: Color) -> void:
    var normal := StyleBoxFlat.new()
    normal.bg_color = normal_color
    normal.border_width_left = 2
    normal.border_width_top = 2
    normal.border_width_right = 2
    normal.border_width_bottom = 2
    normal.border_color = border_color
    normal.corner_radius_top_left = 14
    normal.corner_radius_top_right = 14
    normal.corner_radius_bottom_left = 14
    normal.corner_radius_bottom_right = 14
    button.add_theme_stylebox_override("normal", normal)

    var hover := normal.duplicate() as StyleBoxFlat
    hover.bg_color = hover_color
    button.add_theme_stylebox_override("hover", hover)
    button.add_theme_stylebox_override("pressed", hover)

func _show_battle() -> void:
    current_screen = "battle"
    menu_panel.visible = false
    battle_panel.visible = true
    _reset_match()

func _show_menu() -> void:
    current_screen = "menu"
    battle_panel.visible = false
    menu_panel.visible = true

func _toggle_language() -> void:
    language = "en" if language == "ru" else "ru"
    _refresh_text()
    _refresh_board_labels()

func _refresh_text() -> void:
    var t: Dictionary = TEXT[language]
    subtitle_label.text = t["subtitle"]
    language_button.text = t["settings"]
    play_button.text = t["play"]
    cards_button.text = t["cards"]
    shop_button.text = t["shop"]
    menu_hint_label.text = t["hint"]
    board_hint_label.text = t["board_hint"]
    reset_button.text = t["reset"]
    back_button.text = t["back"]
    version_label.text = "%s %s · %s · #%s" % [t["build"], BuildInfo.VERSION, BuildInfo.COMMIT, BuildInfo.BUILD_NUMBER]
    _update_match_labels()

func _reset_match() -> void:
    move_index = 0
    match_finished = false
    player_count = 0
    opponent_count = 0
    cell_owners.clear()
    cell_elements.clear()
    for index in range(9):
        cell_owners.append(-1)
        cell_elements.append(-1)
        if index < cell_buttons.size():
            var cell := cell_buttons[index]
            cell.disabled = false
            cell.text = "·"
            cell.tooltip_text = "Cell %d" % (index + 1)
            _apply_cell_style(cell, Color("111d38"), Color("1b2e56"), Color("405681"))
    _update_match_labels()

func _on_cell_pressed(index: int) -> void:
    if match_finished:
        return
    if cell_owners[index] != -1:
        status_label.text = TEXT[language]["occupied"]
        _flash_invalid(cell_buttons[index])
        return

    _place_element(index, 0)
    if _check_finish():
        return

    status_label.text = TEXT[language]["turn_opponent"]
    await get_tree().create_timer(0.35).timeout
    if match_finished:
        return
    _perform_opponent_move()
    _check_finish()
    if not match_finished:
        status_label.text = TEXT[language]["turn_player"]

func _place_element(index: int, owner: int) -> void:
    cell_owners[index] = owner
    var element_index := move_index % ELEMENTS.size()
    cell_elements[index] = element_index
    var element: Dictionary = ELEMENTS[element_index]
    move_index += 1
    var button := cell_buttons[index]
    var short_key := "short_ru" if language == "ru" else "short_en"
    button.text = str(element[short_key])
    button.tooltip_text = str(element[language])

    var base_color: Color = element["color"]
    var border := Color("8ac4ff") if owner == 0 else Color("ff8997")
    _apply_cell_style(button, base_color.darkened(0.38), base_color.darkened(0.18), border)

    if owner == 0:
        player_count += 1
    else:
        opponent_count += 1
    _update_match_labels()

func _perform_opponent_move() -> void:
    var free_cells: Array[int] = []
    for index in range(cell_owners.size()):
        if cell_owners[index] == -1:
            free_cells.append(index)
    if free_cells.is_empty():
        return
    var preferred_index := 4 if free_cells.has(4) else free_cells[0]
    _place_element(preferred_index, 1)

func _check_finish() -> bool:
    if player_count >= 5:
        match_finished = true
        status_label.text = TEXT[language]["win_player"]
    elif opponent_count >= 5:
        match_finished = true
        status_label.text = TEXT[language]["win_opponent"]
    elif player_count + opponent_count >= 9:
        match_finished = true
        status_label.text = TEXT[language]["win_player"] if player_count > opponent_count else TEXT[language]["win_opponent"]

    if match_finished:
        for cell in cell_buttons:
            cell.disabled = true
    return match_finished

func _update_match_labels() -> void:
    if opponent_label == null or player_label == null or status_label == null:
        return
    var t: Dictionary = TEXT[language]
    opponent_label.text = "%s · %d/5" % [t["opponent"], opponent_count]
    player_label.text = "%s · %d/5" % [t["player"], player_count]
    if not match_finished:
        status_label.text = t["turn_player"]

func _refresh_board_labels() -> void:
    for index in range(cell_buttons.size()):
        if cell_owners[index] == -1:
            continue
        var element_index := cell_elements[index]
        if element_index < 0:
            continue
        var element: Dictionary = ELEMENTS[element_index]
        var short_key := "short_ru" if language == "ru" else "short_en"
        cell_buttons[index].text = str(element[short_key])

func _flash_invalid(button: Button) -> void:
    var original := button.modulate
    button.modulate = Color("ff6573")
    var tween := create_tween()
    tween.tween_property(button, "modulate", original, 0.25)

func _on_viewport_resized() -> void:
    if content_root == null:
        return
    var compact := size.x < 600.0
    title_label.add_theme_font_size_override("font_size", 30 if compact else 38)
    language_button.custom_minimum_size.x = 120 if compact else 150

func _unhandled_input(event: InputEvent) -> void:
    if event.is_action_pressed("ui_cancel") and current_screen == "battle":
        _show_menu()
        get_viewport().set_input_as_handled()
