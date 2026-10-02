extends Button
## Public board rendering with position-stable stats and a separate direction ring.
const Core = preload("res://src/match_core.gd")
const Style = preload("res://src/ui_theme.gd")
var header: Label
var title_label: Label
var stats: Label
var health: Label
var terrain_label: Label
var occupied: bool = false
var hint: Label
var emblem: Control
var directions: Array[Vector2] = []
var arrow_color: Color = Color.WHITE
func make_label(font: int) -> Label:
    var item := Label.new()
    item.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    item.add_theme_font_size_override("font_size",font)
    item.mouse_filter = Control.MOUSE_FILTER_IGNORE
    item.clip_text = true
    add_child(item)
    return item
func setup(ui, index: int) -> void:
    name = "BoardCell" + str(index)
    set_meta("cell_index",index)
    custom_minimum_size = Vector2(88,88)
    size_flags_horizontal = Control.SIZE_EXPAND_FILL
    size_flags_vertical = Control.SIZE_EXPAND_FILL
    Style.decorate_button(self)
    header = make_label(14)
    title_label = make_label(17)
    title_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    title_label.max_lines_visible = 2
    title_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
    stats = make_label(21)
    health = make_label(21)
    terrain_label = make_label(13)
    hint = make_label(15)
    emblem = preload("res://src/tactical_emblem.gd").new()
    add_child(emblem)
    pressed.connect(ui.on_cell.bind(index))
    resized.connect(arrange)
func arrange() -> void:
    if not is_instance_valid(header):
        return
    header.position = Vector2(9,8)
    header.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT if occupied else HORIZONTAL_ALIGNMENT_CENTER
    var available_width: float = maxf(0,size.x-18.0)
    var owner_width: float = ceilf(header.get_theme_font("font").get_string_size(header.text,HORIZONTAL_ALIGNMENT_LEFT,-1,header.get_theme_font_size("font_size")).x)
    var terrain_width: float = ceilf(terrain_label.get_theme_font("font").get_string_size(terrain_label.text,HORIZONTAL_ALIGNMENT_LEFT,-1,terrain_label.get_theme_font_size("font_size")).x)
    terrain_label.visible = occupied and owner_width+terrain_width+12.0 <= available_width
    header.size = Vector2(available_width-terrain_width-12.0 if terrain_label.visible else available_width,20)
    terrain_label.position = Vector2(size.x-9.0-terrain_width,8)
    terrain_label.size = Vector2(terrain_width,20)
    terrain_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
    title_label.visible = size.y >= 145
    # Reserve two complete shaped lines before placing the emblem or the stats.
    var line_height: float = ceilf(title_label.get_theme_font("font").get_height(title_label.get_theme_font_size("font_size")))
    var name_height: float = line_height * 2.0 + title_label.get_theme_constant("line_spacing") * 2.0
    title_label.position = Vector2(9,size.y - 38.0 - name_height)
    title_label.size = Vector2(maxf(0,size.x-18),name_height)
    stats.position = Vector2(8,size.y-32)
    stats.size = Vector2(maxf(0,size.x*0.5-16 if occupied else size.x-16),26)
    stats.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT if occupied else HORIZONTAL_ALIGNMENT_CENTER
    health.position = Vector2(size.x*0.5+8,size.y-32)
    health.size = Vector2(maxf(0,size.x*0.5-16),26)
    health.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
    health.add_theme_font_size_override("font_size",21 if size.x >= 140 else 16)
    stats.add_theme_font_size_override("font_size",21 if size.x >= 140 else 16)
    hint.position = Vector2(8,size.y * 0.32)
    hint.size = Vector2(maxf(0,size.x-16),44)
    hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    var span: float = minf(64,minf(size.x,size.y)*0.3)
    var emblem_y: float = size.y*0.31-span*0.16
    if title_label.visible:
        var available_height: float = maxf(0,title_label.position.y-38.0)
        span = minf(span,available_height)
        emblem_y = 32.0 + (available_height-span)/2.0
    emblem.position = Vector2((size.x-span)/2,emblem_y)
    emblem.size = Vector2(span,span)
    queue_redraw()
func present(ui, view: Dictionary, index: int, targets: Array, can_attack: bool) -> void:
    var unit: Variant = view.board[index]
    occupied = unit != null
    var terrain: int = int(view.terrain[index])
    var color: Color = ui.COLORS[terrain]
    var field: String = ui.t(Core.ELEMENTS_RU[terrain],Core.ELEMENTS_EN[terrain])
    var locked: bool = index == 4 and not bool(view.center_unlocked)
    disabled = locked
    var selected: bool = index == ui.selected_unit
    var allowed: bool = false
    for command in view.legal:
        if command.get("type") == "play" and ui.selected_hand >= 0 and int(command.hand) == ui.selected_hand and int(command.cell) == index:
            allowed = true
    var threatened: bool = index in targets and can_attack
    var border: Color = color.darkened(0.2)
    var bg: Color = color.darkened(0.91)
    directions.clear()
    emblem.visible = unit != null
    hint.visible = unit == null
    stats.text = ""
    health.text = ""
    terrain_label.text = field
    title_label.text = ""
    header.text = field
    hint.text = "◇"
    hint.add_theme_color_override("font_color",Color("839599"))
    if locked:
        hint.text = ui.t("ЦЕНТР\nЗАКРЫТ", "CENTER\nLOCKED")
        stats.text = "%d/5 · %d/7" % [int(view.scores[0])+int(view.scores[1]), mini(int(view.turn),7)]
        tooltip_text = ui.t("Центр откроется при 5 юнитах или на ходу 7", "Center opens at five units or turn seven")
        border = Color("727c90")
    elif unit != null:
        var definition: Dictionary = ui.game.card(int(unit.id))
        header.text = ui.t("ТЫ", "YOU") if int(unit.owner) == 0 else ui.t("ВРАГ", "ENEMY")
        title_label.text = str(definition[ui.language])
        stats.text = "⚔ %d" % unit.attack
        health.text = "♥ %d" % unit.health
        border = Color("75c6ed") if int(unit.owner) == 0 else Color("ea9b90")
        emblem.configure(str(definition.kind),ui.COLORS[int(definition.element)])
        var offsets: Array[Vector2i] = [Vector2i(0,-1)]
        if definition.kind == "guard":
            offsets = [Vector2i(-1,0),Vector2i(0,-1),Vector2i(1,0)]
        elif definition.kind == "flanker":
            offsets = [Vector2i(-1,-1),Vector2i(1,-1)]
        for point in offsets:
            directions.append(Vector2(Core.rotated(point,int(unit.direction))).normalized())
        arrow_color = border
        tooltip_text = title_label.text + " · " + field + "\n" + ui.t("Касание выбирает или открывает описание. Атака — отдельной кнопкой.", "Tap selects or opens details. Attack is a separate button.")
    if allowed:
        border = Color("9cdfb9")
        bg = Color("173c32")
        hint.text = ui.t("СЮДА", "DEPLOY")
        hint.add_theme_color_override("font_color",Style.TEXT)
    if threatened:
        border = Color("efb36e") if int(unit.owner) == 0 else Color("ec7e77")
        header.text = ui.t("СОЮЗНИК!", "ALLY!") if int(unit.owner) == 0 else ui.t("ЦЕЛЬ", "TARGET")
    if selected:
        border = Color("f1d899")
        header.text = ui.t("ВЫБРАН", "SELECTED")
    var box: StyleBoxFlat = Style.box(bg,border)
    box.set_border_width_all(3 if selected or allowed or threatened else 1)
    box.content_margin_left = 3
    box.content_margin_right = 3
    box.content_margin_top = 3
    box.content_margin_bottom = 3
    for state in ["normal","hover","pressed","disabled"]:
        add_theme_stylebox_override(state,box)
    modulate = Color.WHITE
    arrange()
func _draw() -> void:
    for direction in directions:
        var radius: float = minf(size.x,size.y)*0.45
        var point: Vector2 = size/2 + direction*radius
        var side: Vector2 = Vector2(-direction.y,direction.x)
        draw_colored_polygon(PackedVector2Array([point,point-direction*9+side*5,point-direction*9-side*5]),arrow_color)
