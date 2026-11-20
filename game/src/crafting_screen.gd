extends VBoxContainer
signal leave_requested
const Craft = preload("res://src/crafting_rules.gd")
const Deck = preload("res://src/deck_rules.gd")
const Policy = preload("res://src/crafting_policy.gd")
var host: Control
var picker: OptionButton
var detail: Label
var wallet: Label
var status: Label
var craft_button: Button
var recycle_button: Button
var inspector: AcceptDialog
var details_button: Button
var confirm: ConfirmationDialog
var requested: Dictionary = {}
var pending: Dictionary = {}
var busy: bool = false
func selected_code() -> String:
    return str(picker.get_selected_metadata())
func setup(owner_ui: Control) -> void:
    host = owner_ui
    name = "CraftingScreen"
    size_flags_horizontal = Control.SIZE_EXPAND_FILL
    size_flags_vertical = Control.SIZE_EXPAND_FILL
    add_theme_constant_override("separation", 12)
    preload("res://src/scrollable_page.gd").wrap(self)
    add_child(host.label(host.t("СОЗДАНИЕ КАРТ", "CARD CRAFTING"), 30))
    wallet = host.label("", 24)
    add_child(wallet)
    picker = OptionButton.new()
    picker.name = "CraftPicker"
    picker.custom_minimum_size.y = 64
    picker.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    picker.add_theme_font_size_override("font_size", 21)
    for id in range(Deck.CARD_COUNT):
        picker.add_item(str(host.game.card(id)[host.language]))
        picker.set_item_metadata(id, Deck.code(id))
    picker.item_selected.connect(func(_index): refresh())
    add_child(picker)
    detail = host.label("", 20)
    add_child(detail)
    inspector = preload("res://src/card_inspector.gd").new()
    add_child(inspector)
    details_button = host.button(host.t("ПОДРОБНЕЕ О КАРТЕ", "CARD DETAILS"), show_details, 64)
    details_button.name = "InspectCraftCard"
    add_child(details_button)
    craft_button = host.button("", request_craft, 76)
    craft_button.name = "CraftCard"
    add_child(craft_button)
    recycle_button = host.button("", request_recycle, 76)
    recycle_button.name = "RecycleCard"
    add_child(recycle_button)
    status = host.label("", 19)
    status.name = "CraftStatus"
    add_child(status)
    add_child(host.label(host.t("Создание возвращает обычную копию, не усиливает её характеристики. Разобрать можно только копию, не нужную ни одной сохранённой колоде, включая черновики. Разбор требует подтверждения.", "Crafting creates a normal copy, never upgrades its stats. Only copies unused by every saved deck, including drafts, may be recycled. Recycling requires confirmation."), 19))
    add_child(host.label(host.t("В альфе уже открыты все карты по две: создание станет доступно после появления недостающей копии. Полученные ранее карты не отнимаются. Тестовые цены можно изменить в отдельной версии политики.", "This alpha already includes two of every card: crafting is available only for a missing copy. Previously granted cards are never taken away. Prices are versioned test values."), 18))
    var back: Button = host.button(host.t("В МЕНЮ", "MENU"), func(): leave_requested.emit(), 64)
    back.name = "CraftBack"
    add_child(back)
    confirm = ConfirmationDialog.new()
    confirm.name = "ConfirmRecycle"
    confirm.title = host.t("ПОДТВЕРЖДЕНИЕ РАЗБОРА", "CONFIRM RECYCLING")
    confirm.dialog_autowrap = true
    confirm.add_theme_constant_override("buttons_min_width", 170)
    confirm.add_theme_constant_override("buttons_min_height", 64)
    confirm.get_label().add_theme_font_size_override("font_size", 20)
    confirm.get_ok_button().text = host.t("РАЗОБРАТЬ", "RECYCLE")
    confirm.get_cancel_button().text = host.t("ОТМЕНА", "CANCEL")
    confirm.get_ok_button().add_theme_font_size_override("font_size", 20)
    confirm.get_cancel_button().add_theme_font_size_override("font_size", 20)
    confirm.confirmed.connect(_confirmed)
    confirm.canceled.connect(func(): requested.clear())
    add_child(confirm)
    refresh()
func show_details() -> void:
    inspector.open_card(Deck.card_id(selected_code()), host.language, details_button)

func refresh() -> void:
    var p: Dictionary = host.profile.state()
    var code: String = selected_code()
    var card: Dictionary = host.game.card(Deck.card_id(code))
    wallet.text = host.t("Пыль: %d", "Dust: %d") % int(p.wallet.dust)
    detail.text = str(card[host.language]) + host.t(" · в коллекции: %d/2 · нужно колодам: %d", " · owned: %d/2 · needed by decks: %d") % [int(p.inventory.get(code, 0)), Craft.required_copies(p, code)]
    detail.text += "\n◉ %d · ⚔ %d · ♥ %d" % [card.cost, card.attack, card.health]
    craft_button.text = host.t("ПОВТОРИТЬ СОХРАНЕНИЕ", "RETRY SAVING") if not pending.is_empty() else host.t("СОЗДАТЬ · %d ПЫЛИ", "CRAFT · %d DUST") % Policy.COST
    recycle_button.text = host.t("РАЗОБРАТЬ ЛИШНЮЮ КОПИЮ · +%d ПЫЛИ", "RECYCLE SPARE COPY · +%d DUST") % Policy.RECYCLE
    var available: bool = host.profile.enabled and not busy
    picker.disabled = not available or not pending.is_empty()
    craft_button.disabled = not available or (pending.is_empty() and not Craft.quote(p, code, "card_craft").ok)
    recycle_button.disabled = not available or not pending.is_empty() or not Craft.quote(p, code, "card_recycle").ok
func request_craft() -> void:
    if busy or not host.profile.enabled:
        return
    if pending.is_empty():
        var action: Dictionary = {"kind": "card_craft", "card": selected_code()}
        if not Craft.quote(host.profile.state(), action.card, action.kind).ok:
            return
        pending = action
    _commit_pending()
func request_recycle() -> void:
    if busy or not pending.is_empty() or not host.profile.enabled:
        return
    var code: String = selected_code()
    if not Craft.quote(host.profile.state(), code, "card_recycle").ok:
        return
    requested = {"kind": "card_recycle", "card": code}
    confirm.dialog_text = host.t("Разобрать одну лишнюю копию «%s» за %d пыли? Колоды не изменятся.", "Recycle one spare copy of “%s” for %d dust? Saved decks will not change.") % [host.game.card(Deck.card_id(code))[host.language], Policy.RECYCLE]
    confirm.popup_centered(Vector2i(580, 260))
func _confirmed() -> void:
    if requested.is_empty():
        return
    pending = requested.duplicate(true)
    requested.clear()
    _commit_pending()
func _commit_pending() -> void:
    if pending.is_empty() or busy:
        return
    busy = true
    refresh()
    var ok: bool = host.profile.commit(pending)
    busy = false
    if ok:
        pending.clear()
        status.text = host.t("Карта и изменение пыли сохранены вместе", "Card and dust change saved together")
    else:
        status.text = host.t("Сохранение не подтверждено; повтор безопасен: ", "Save unconfirmed; retry is safe: ") + host.profile.error
    refresh()
