extends VBoxContainer
## User-facing deck editor. Unsaved state is local; all writes go through ProfileController.
signal leave_requested
signal play_requested
const Deck = preload("res://src/deck_rules.gd")
const Collection = preload("res://src/collection_rules.gd")
const Catalog = preload("res://src/catalog_view.gd")
const Core = preload("res://src/match_core.gd")
const Feedback = preload("res://src/combat_feedback.gd")
var ui
var draft_id: String = ""
var draft_cards: Array[String] = []
var baseline_cards: Array[String] = []
var baseline_name: String = ""
var existing: bool = false
var picker: OptionButton
var name_input: LineEdit
var search: LineEdit
var elements: OptionButton
var tabs: TabBar
var rows: VBoxContainer
var scroll: ScrollContainer
var status: Label
var save_button: Button
var choose_button: Button
var delete_button: Button
var play_button: Button
var new_button: Button
var back_button: Button
var inspector: AcceptDialog
var confirmation: ConfirmationDialog
var pending_action: Callable

func t(ru: String, en: String) -> String:
    return ui.t(ru, en)

func setup(owner_ui) -> void:
    ui = owner_ui
    name = "CollectionScreen"
    size_flags_vertical = Control.SIZE_EXPAND_FILL
    add_theme_constant_override("separation", 8)
    add_child(ui.label(t("КОЛЛЕКЦИЯ И КОЛОДЫ", "COLLECTION AND DECKS"), 28))
    add_child(ui.label(t("Альфа: 30 карт × 2 копии · 15 карт в колоде", "Alpha: 30 cards × 2 copies · 15 cards per deck"), 17))
    var top := HBoxContainer.new()
    add_child(top)
    picker = OptionButton.new()
    picker.name = "DeckPicker"
    picker.custom_minimum_size = Vector2(0, 54)
    picker.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    picker.fit_to_longest_item = false
    picker.item_selected.connect(_picked)
    top.add_child(picker)
    new_button = ui.button(t("НОВАЯ", "NEW"), request_new, 54)
    new_button.size_flags_horizontal = Control.SIZE_SHRINK_END
    new_button.name = "NewDeck"
    new_button.custom_minimum_size.x = 96
    top.add_child(new_button)
    name_input = LineEdit.new()
    name_input.name = "DeckName"
    name_input.max_length = 48
    name_input.placeholder_text = t("Название колоды", "Deck name")
    name_input.custom_minimum_size.y = 54
    name_input.text_changed.connect(func(_text: String): _update_status())
    add_child(name_input)
    var actions := HBoxContainer.new()
    add_child(actions)
    save_button = ui.button(t("СОХРАНИТЬ", "SAVE"), save_deck, 54)
    save_button.name = "SaveDeck"
    choose_button = ui.button(t("ВЫБРАТЬ", "SELECT"), select_deck, 54)
    choose_button.name = "SelectDeck"
    delete_button = ui.button(t("УДАЛИТЬ", "DELETE"), request_delete, 54)
    delete_button.name = "DeleteDeck"
    for control in [save_button, choose_button, delete_button]:
        actions.add_child(control)
    status = ui.label("", 18)
    status.name = "DeckStatus"
    add_child(status)
    tabs = TabBar.new()
    tabs.name = "CollectionTabs"
    tabs.custom_minimum_size.y = 50
    tabs.add_tab(t("КАТАЛОГ", "CATALOG"))
    tabs.add_tab(t("В КОЛОДЕ", "IN DECK"))
    tabs.tab_changed.connect(func(_index: int): _refresh_rows())
    add_child(tabs)
    search = LineEdit.new()
    search.name = "CardSearch"
    search.max_length = 80
    search.placeholder_text = t("Поиск карты, стихии или роли (RU/EN)", "Search card, element or role (RU/EN)")
    search.custom_minimum_size.y = 50
    search.text_changed.connect(func(_text: String): _refresh_rows())
    add_child(search)
    elements = OptionButton.new()
    elements.name = "ElementFilter"
    elements.custom_minimum_size.y = 50
    elements.add_item(t("Все стихии", "All elements"))
    for index in range(Core.ELEMENTS.size()):
        elements.add_item(t(Core.ELEMENTS_RU[index], Core.ELEMENTS_EN[index]))
    elements.item_selected.connect(func(_index: int): _refresh_rows())
    add_child(elements)
    scroll = ScrollContainer.new()
    scroll.name = "CollectionScroll"
    scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
    scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
    scroll.follow_focus = true
    add_child(scroll)
    rows = VBoxContainer.new()
    rows.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    rows.add_theme_constant_override("separation", 8)
    scroll.add_child(rows)
    play_button = ui.button(t("ИГРАТЬ ВЫБРАННОЙ ПРОТИВ ИИ", "PLAY SELECTED DECK VS AI"), _play, 62)
    play_button.name = "PlaySelectedDeck"
    add_child(play_button)
    back_button = ui.button(t("В МЕНЮ", "MENU"), request_leave, 54)
    back_button.name = "CollectionBack"
    add_child(back_button)
    confirmation = ConfirmationDialog.new()
    confirmation.title = t("Подтверждение", "Confirmation")
    confirmation.get_ok_button().text = t("Продолжить", "Continue")
    confirmation.get_cancel_button().text = t("Отмена", "Cancel")
    confirmation.confirmed.connect(_confirmed)
    confirmation.canceled.connect(func(): pending_action = Callable())
    add_child(confirmation)
    preload("res://src/ui_theme.gd").decorate_dialog(confirmation)
    inspector = preload("res://src/card_inspector.gd").new()
    add_child(inspector)
    var state: Dictionary = ui.profile.state()
    if state.has("collection") and not state.decks.is_empty():
        var selected: String = str(state.collection.selected)
        load_deck(selected if state.decks.has(selected) else str(state.decks.keys()[0]))
    else:
        _new_deck()

func is_dirty() -> bool:
    return not existing or name_input.text != baseline_name or draft_cards != baseline_cards

func _refresh_picker() -> void:
    picker.clear()
    var state: Dictionary = ui.profile.state()
    for id in state.decks:
        var title: String = str(state.collection.names[id])
        if state.collection.selected == id:
            title = "✓ " + title
        picker.add_item(title)
        picker.set_item_metadata(picker.item_count - 1, id)
        if id == draft_id:
            picker.select(picker.item_count - 1)
    if not existing:
        picker.add_item(t("Новый черновик", "New draft"))
        picker.set_item_metadata(picker.item_count - 1, draft_id)
        picker.select(picker.item_count - 1)
    new_button.disabled = state.decks.size() >= Collection.MAX_DECKS

func load_deck(id: String) -> void:
    var state: Dictionary = ui.profile.state()
    if not state.decks.has(id):
        return
    draft_id = id
    existing = true
    draft_cards.assign(state.decks[id])
    baseline_cards = draft_cards.duplicate()
    baseline_name = str(state.collection.names[id])
    name_input.text = baseline_name
    _refresh_picker()
    _refresh_rows()

func _new_deck() -> void:
    draft_id = "deck-" + Crypto.new().generate_random_bytes(8).hex_encode()
    existing = false
    draft_cards.clear()
    baseline_cards.clear()
    baseline_name = ""
    name_input.text = t("Моя колода", "My deck")
    _refresh_picker()
    _refresh_rows()

func _ask(action: Callable, text: String) -> void:
    pending_action = action
    confirmation.dialog_text = text
    confirmation.popup_centered(Vector2i(580, 200))

func _confirmed() -> void:
    var action: Callable = pending_action
    pending_action = Callable()
    if action.is_valid():
        action.call()

func _guard_discard(action: Callable) -> void:
    if is_dirty():
        _ask(action, t("Несохранённые изменения будут потеряны. Продолжить?", "Unsaved changes will be lost. Continue?"))
    else:
        action.call()

func _picked(index: int) -> void:
    var id: String = str(picker.get_item_metadata(index))
    _refresh_picker()
    if id != draft_id:
        _guard_discard(load_deck.bind(id))

func request_new() -> void:
    if not new_button.disabled:
        _guard_discard(_new_deck)

func request_leave() -> void:
    _guard_discard(func(): leave_requested.emit())

func request_delete() -> void:
    if existing:
        _ask(_delete_deck, t("Удалить колоду? Карты останутся в коллекции.", "Delete this deck? Your cards will remain in the collection."))

func _delete_deck() -> void:
    if not ui.profile.commit({"kind": "deck_delete", "id": draft_id}):
        _error()
        return
    var state: Dictionary = ui.profile.state()
    if state.decks.is_empty():
        _new_deck()
    else:
        load_deck(str(state.decks.keys()[0]))

func save_deck() -> bool:
    var command: Dictionary = {"kind": "deck_save", "id": draft_id, "name": name_input.text.strip_edges(), "cards": draft_cards.duplicate()}
    if not ui.profile.commit(command):
        _error()
        return false
    load_deck(draft_id)
    status.text += t(" · сохранено", " · saved")
    return true

func select_deck() -> void:
    if is_dirty() or not existing:
        return
    if not ui.profile.commit({"kind": "deck_select", "id": draft_id}):
        _error()
        return
    _refresh_picker()
    _update_status()

func _play() -> void:
    if not play_button.disabled:
        play_requested.emit()

func _error() -> void:
    status.text = t("Не удалось сохранить. Повтори действие: ", "Could not save. Retry this action: ") + ui.profile.error

func _update_status() -> void:
    if not is_instance_valid(status):
        return
    var state: Dictionary = ui.profile.state()
    var parsed: Dictionary = Deck.validate_codes(draft_cards, state.get("inventory", {}), true)
    var ready: bool = parsed.get("ok", false) and parsed.get("ready", false)
    var selected: bool = state.get("collection", {}).get("selected", "") == draft_id
    save_button.disabled = not parsed.ok or not Deck.valid_name(name_input.text.strip_edges())
    choose_button.disabled = not ready or is_dirty() or not existing
    delete_button.disabled = not existing
    play_button.disabled = not selected or is_dirty() or not ready
    status.text = t("Карт %d/%d", "Cards %d/%d") % [draft_cards.size(), Deck.SIZE]
    status.text += t(" · не сохранено", " · unsaved") if is_dirty() else t(" · сохранено", " · saved")
    status.text += t(" · ВЫБРАНА", " · SELECTED") if selected else ""
    if not ready:
        status.text += t(" · черновик: добавь %d", " · draft: add %d") % (Deck.SIZE - draft_cards.size())

func change_card(code: String, delta: int) -> void:
    if delta == -1:
        var index: int = draft_cards.find(code)
        if index < 0:
            return
        draft_cards.remove_at(index)
    elif delta == 1:
        var proposed: Array[String] = draft_cards.duplicate()
        proposed.append(code)
        if not Deck.validate_codes(proposed, ui.profile.state().inventory, true).ok:
            return
        draft_cards = proposed
    else:
        return
    _refresh_rows()

func _inspect_card(id: int) -> void:
    inspector.open_card(id, ui.language, find_child("Details_" + Deck.code(id), true, false))

func _refresh_rows() -> void:
    if not is_instance_valid(rows):
        return
    for child in rows.get_children():
        rows.remove_child(child)
        child.queue_free()
    var state: Dictionary = ui.profile.state()
    var definitions: Array[Dictionary] = Catalog.rows(state, search.text, elements.selected - 1)
    var shown: int = 0
    for card in definitions:
        var count: int = draft_cards.count(card.code)
        if tabs.current_tab == 1 and count == 0:
            continue
        shown += 1
        var line := HBoxContainer.new()
        line.name = "Card_" + str(card.code)
        rows.add_child(line)
        var description: String = str(card[ui.language])
        description += " · " + t(Core.ELEMENTS_RU[int(card.element)], Core.ELEMENTS_EN[int(card.element)])
        description += "\n" + t(Core.TYPES_RU[int(card.role)], Core.TYPES_EN[int(card.role)]) + " · " + Feedback.pattern(card, 0)
        description += "\n◉ %d  ⚔ %d  ♥ %d" % [card.cost, card.attack, card.health]
        description += t(" · в колоде %d / есть %d", " · in deck %d / owned %d") % [count, card.owned]
        var text: Label = ui.label(description, 17)
        text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
        text.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
        var description_column := VBoxContainer.new()
        description_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
        line.add_child(description_column)
        description_column.add_child(text)
        var details: Button = ui.button(t("ПОДРОБНЕЕ О КАРТЕ", "CARD DETAILS"), _inspect_card.bind(int(card.id)), 56)
        details.name = "Details_" + str(card.code)
        description_column.add_child(details)
        var remove: Button = ui.button("−", change_card.bind(str(card.code), -1), 66)
        remove.name = "Remove_" + str(card.code)
        remove.custom_minimum_size.x = 60
        remove.size_flags_horizontal = Control.SIZE_SHRINK_END
        remove.disabled = count == 0
        line.add_child(remove)
        var add: Button = ui.button("+", change_card.bind(str(card.code), 1), 66)
        add.name = "Add_" + str(card.code)
        add.custom_minimum_size.x = 60
        add.size_flags_horizontal = Control.SIZE_SHRINK_END
        add.disabled = count >= mini(int(card.owned), Deck.MAX_COPIES) or draft_cards.size() >= Deck.SIZE
        line.add_child(add)
    if shown == 0:
        rows.add_child(ui.label(t("Карты не найдены. Измени поиск или фильтр.", "No cards found. Change the search or filter."), 18))
    _update_status()
