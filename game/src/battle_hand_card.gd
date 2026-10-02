extends Button
## Stable hand-slot control. Playing and reading are separate hit targets.
const Style = preload("res://src/ui_theme.gd")
const Feedback = preload("res://src/combat_feedback.gd")
var card_id: int = -1
var slot: int = -1
var owner_ui: WeakRef
var cost: Label
var title_label: Label
var stats: Label
var pattern: Label
var details: Button
var emblem: Control
func piece(font: int) -> Label:
    var result := Label.new()
    result.add_theme_font_size_override("font_size",font)
    result.add_theme_color_override("font_color",Style.TEXT)
    result.mouse_filter = Control.MOUSE_FILTER_IGNORE
    result.clip_text = true
    add_child(result)
    return result
func setup(ui, index: int) -> void:
    name = "HandCard" + str(index)
    slot = index
    owner_ui = weakref(ui)
    custom_minimum_size = Vector2(174,184)
    size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
    Style.decorate_button(self)
    cost = piece(22)
    title_label = piece(18)
    title_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    title_label.max_lines_visible = 2
    stats = piece(19)
    pattern = piece(15)
    emblem = preload("res://src/tactical_emblem.gd").new()
    add_child(emblem)
    details = ui.button(ui.t("ОПИСАНИЕ", "DETAILS"), func():
        var host: Variant = owner_ui.get_ref()
        if host != null:
            host.open_battle_card(card_id, details)
    , 44)
    details.name = "InspectHand" + str(index)
    details.add_theme_font_size_override("font_size",15)
    add_child(details)
    pressed.connect(func():
        var host: Variant = owner_ui.get_ref()
        if host != null:
            host.on_hand(slot)
    )
    resized.connect(arrange)
    arrange()
func arrange() -> void:
    if not is_instance_valid(cost):
        return
    cost.position = Vector2(10,7)
    cost.size = Vector2(76,29)
    emblem.position = Vector2(size.x - 47,4)
    emblem.size = Vector2(40,36)
    title_label.position = Vector2(10,40)
    title_label.size = Vector2(maxf(0,size.x-20),46)
    stats.position = Vector2(10,86)
    stats.size = Vector2(maxf(0,size.x-20),25)
    pattern.position = Vector2(10,111)
    pattern.size = Vector2(maxf(0,size.x-20),22)
    details.position = Vector2(6,size.y-48)
    details.size = Vector2(maxf(0,size.x-12),42)
func present(ui, definition: Dictionary, facing: int, selected: bool, reason: String) -> void:
    card_id = int(definition.id)
    disabled = reason != "ready"
    cost.text = "◉ " + str(definition.cost)
    cost.add_theme_color_override("font_color",Color("f2ce83") if reason != "coins" else Color("f1b5a6"))
    title_label.text = str(definition[ui.language])
    stats.text = "⚔ %d     ♥ %d" % [definition.attack,definition.health]
    pattern.text = ui.t(ui.Core.ELEMENTS_RU[int(definition.element)],ui.Core.ELEMENTS_EN[int(definition.element)]) + " · " + Feedback.pattern(definition,facing)
    var descriptions: Dictionary = {"coins":["Недостаточно монет", "Not enough coins"],"opponent":["Ход соперника", "Opponent's turn"],"placed":["Карта уже размещена", "A card was already placed"],"pending":["Ожидаем подтверждения", "Waiting for acknowledgement"],"finished":["Партия завершена", "Match finished"],"space":["Нет доступных клеток", "No available cells"]}
    var why: String = ui.t("Коснитесь, затем выберите клетку", "Tap, then choose a cell")
    if descriptions.has(reason):
        why = ui.t(descriptions[reason][0],descriptions[reason][1])
    tooltip_text = title_label.text + "\n" + why + "\n" + ui.t("Описание доступно всегда", "Details always available")
    details.tooltip_text = tooltip_text
    details.text = ui.t("ОПИСАНИЕ", "DETAILS")
    details.disabled = false
    Style.hand_card(self,ui.COLORS[int(definition.element)],selected)
    emblem.configure(str(definition.kind),ui.COLORS[int(definition.element)])
    arrange()
