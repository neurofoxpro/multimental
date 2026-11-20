extends RefCounted
const Style = preload("res://src/ui_theme.gd")
const Grid = preload("res://src/action_grid.gd")

static func section(ui, content: VBoxContainer, title: String) -> GridContainer:
    var heading: Label = ui.label(title, 17)
    heading.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
    heading.add_theme_color_override("font_color", Style.ACCENT)
    content.add_child(heading)
    var grid := Grid.new()
    content.add_child(grid)
    return grid

static func action(ui, parent: Node, id: String, text: String, callback: Callable, height: int = 66) -> Button:
    var control: Button = ui.button(text, callback, height)
    control.name = id
    parent.add_child(control)
    return control

static func build(ui, content: VBoxContainer) -> void:
    content.add_child(ui.label("MULTIMENTAL", 36))
    content.add_child(ui.label(ui.t("Тактическая дуэль · 10 стихий · поле 3×3", "Tactical duel · 10 elements · 3×3 board"), 18))
    var play: Button = action(ui, content, "PlayAI", ui.t("ИГРАТЬ ПРОТИВ ИИ", "PLAY AGAINST AI"), ui.start_match, 78)
    Style.decorate_button(play, true)
    var state: Dictionary = ui.profile.state()
    var readiness: Dictionary = preload("res://src/home_deck_status.gd").inspect(state)
    var deck_text: String = ""
    if readiness.starter:
        deck_text = ui.t("Быстрый старт: стандартная колода", "Quick start: starter deck")
    elif readiness.ready:
        deck_text = ui.t("Готова колода: ", "Ready deck: ") + str(readiness.name) + " · %d/%d" % [int(readiness.count), preload("res://src/deck_rules.gd").SIZE]
    else:
        play.text = ui.t("ВЫБРАТЬ КОЛОДУ ДЛЯ ИГРЫ", "CHOOSE A DECK TO PLAY")
        var reason: String = str(readiness.reason)
        if reason == "DECK_SIZE":
            deck_text = ui.t("Колода неполная: ", "Incomplete deck: ") + "%d/%d" % [int(readiness.count), preload("res://src/deck_rules.gd").SIZE]
        elif reason == "CARD_NOT_OWNED":
            deck_text = ui.t("В колоде отсутствуют доступные карты", "Some cards in the deck are not owned")
        else:
            deck_text = ui.t("Нет выбранной полной колоды", "No complete deck selected")
    var deck: Label = ui.label(deck_text, 18)
    deck.name = "SelectedDeckSummary"
    deck.add_theme_color_override("font_color", Style.ACCENT if readiness.ready else Style.MUTED)
    content.add_child(deck)
    action(ui, content, "ChangeSelectedDeck", ui.t("СМЕНИТЬ КОЛОДУ", "CHANGE DECK"), ui.show_collection, 56)
    var friends: GridContainer = section(ui, content, ui.t("СЫГРАТЬ С ДРУГОМ", "PLAY WITH A FRIEND"))
    action(ui, friends, "OpenLAN", ui.t("ЛОКАЛЬНАЯ СЕТЬ / WI-FI", "LOCAL NETWORK / WI-FI"), ui.show_lan_menu)
    if OS.has_feature("android"):
        action(ui, friends, "OpenBluetooth", "BLUETOOTH", ui.show_bluetooth_menu)
    var cards: GridContainer = section(ui, content, ui.t("КАРТЫ И ПРОГРЕСС", "CARDS AND PROGRESS"))
    action(ui, cards, "OpenCollection", ui.t("КОЛЛЕКЦИЯ И КОЛОДЫ", "COLLECTION AND DECKS"), ui.show_collection)
    action(ui, cards, "OpenShop", ui.t("МАГАЗИН ПАКОВ", "CARD PACK SHOP"), ui.show_shop)
    action(ui, cards, "OpenCrafting", ui.t("СОЗДАНИЕ КАРТ", "CARD CRAFTING"), ui.show_crafting)
    action(ui, cards, "OpenRewards", ui.t("НАГРАДЫ И ЗАДАНИЯ", "REWARDS AND QUESTS"), ui.show_rewards)
    var help: GridContainer = section(ui, content, ui.t("ОСВОИТЬ ИГРУ И НАСТРОИТЬ", "LEARN AND CUSTOMIZE"))
    action(ui, help, "OpenTutorial", ui.t("ОБУЧЕНИЕ", "TUTORIAL"), ui.start_tutorial)
    action(ui, help, "OpenGuide", ui.t("КАРТЫ И ПРАВИЛА", "CARDS AND RULES"), ui.show_card_guide)
    action(ui, help, "OpenSettings", ui.t("НАСТРОЙКИ ЗВУКА", "AUDIO SETTINGS"), ui.show_audio_settings)
    action(ui, help, "ChangeLanguage", ui.t("ЯЗЫК: РУССКИЙ", "LANGUAGE: ENGLISH"), ui.toggle_language)
    var stats: Dictionary = state.get("stats", {"matches": 0, "wins": 0, "losses": 0})
    var xp: int = int(state.get("rewards", {}).get("xp", 0))
    var text: String = ui.t("Партий %d · Побед %d · Поражений %d", "Matches %d · Wins %d · Losses %d") % [stats.matches, stats.wins, stats.losses]
    text += ui.t("\nУровень %d · Опыт %d · Монеты %d", "\nLevel %d · XP %d · Coins %d") % [preload("res://src/rewards_policy.gd").level(xp), xp, int(state.get("wallet", {}).get("gold", 0))]
    if ui.profile.error != "" and ui.profile.enabled:
        text += ui.t("\nСохранение недоступно: ", "\nSaving unavailable: ") + ui.profile.error
    elif ui.profile.recovered:
        text += ui.t("\nВосстановлена резервная копия", "\nRecovered from backup")
    if ui.collection_error != "":
        text += "\n" + ui.collection_error
    var summary: Label = ui.label(text, 17)
    summary.name = "ProfileSummary"
    content.add_child(summary)
    content.add_child(ui.label(BuildInfo.VERSION + " · " + BuildInfo.COMMIT, 14))
    ui.call_deferred("_focus_control", weakref(play))
