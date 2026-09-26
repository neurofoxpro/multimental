extends VBoxContainer
## Presentation only. Transactions and persistence belong to the profile controller.
signal leave_requested
const Economy = preload("res://src/economy_rules.gd")
const Deck = preload("res://src/deck_rules.gd")
var host: Control
var balance: Label
var status: Label
var results: VBoxContainer
var buy: Button
var purchase: Dictionary = {}
var busy: bool = false

func setup(owner_ui: Control) -> void:
    host = owner_ui
    name = "ShopScreen"
    size_flags_horizontal = Control.SIZE_EXPAND_FILL
    size_flags_vertical = Control.SIZE_EXPAND_FILL
    add_theme_constant_override("separation", 12)
    add_child(host.label(host.t("МАГАЗИН", "SHOP"), 30))
    balance = host.label("", 24)
    balance.name = "ShopBalance"
    add_child(balance)
    buy = host.button("", purchase_pack, 76)
    buy.name = "BuyPack"
    add_child(buy)
    status = host.label("", 18)
    status.name = "ShopStatus"
    add_child(status)
    var scroll := ScrollContainer.new()
    scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
    scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
    add_child(scroll)
    var content := VBoxContainer.new()
    content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    content.add_theme_constant_override("separation", 14)
    scroll.add_child(content)
    content.add_child(host.label(host.t("Тестовый магазин без реальных платежей. При первом входе выдано 500 монет — на пять паков. Награды и крафт будут добавлены отдельно.", "Test shop, no real payments. First entry grants 500 coins for five packs. Rewards and crafting will be added separately."), 18))
    content.add_child(host.label(host.t("Пак: 5 случайных карт. Каждая из 30 карт имеет одинаковый шанс 1/30 на каждом месте; повторы внутри пака возможны. Лишняя копия сверх двух превращается в 10 пыли.", "Pack: 5 random cards. Each of 30 cards has the same 1/30 chance in each slot; duplicates are possible. A copy beyond two becomes 10 dust."), 18))
    content.add_child(host.label(host.t("В этой альфе коллекция 30×2 уже открыта: паки не отнимают карты и дают пыль за лишние копии.", "This alpha already unlocks the 30×2 collection: packs never remove cards and grant dust for excess copies."), 18))
    results = VBoxContainer.new()
    results.name = "PackResults"
    results.add_theme_constant_override("separation", 8)
    content.add_child(results)
    var back: Button = host.button(host.t("В МЕНЮ", "MENU"), func(): leave_requested.emit(), 62)
    back.name = "ShopBack"
    add_child(back)
    refresh()

func refresh() -> void:
    var state: Dictionary = host.profile.state()
    var wallet: Dictionary = state.get("wallet", {"gold": 0, "dust": 0})
    balance.text = host.t("Монеты: %d · Пыль: %d", "Coins: %d · Dust: %d") % [wallet.gold, wallet.dust]
    buy.text = host.t("ПОВТОРИТЬ СОХРАНЕНИЕ", "RETRY SAVING") if not purchase.is_empty() else host.t("ОТКРЫТЬ ПАК · 100 МОНЕТ", "OPEN PACK · 100 COINS")
    buy.disabled = busy or not host.profile.enabled or (purchase.is_empty() and int(wallet.gold) < Economy.PACK_PRICE)
    for child in results.get_children():
        results.remove_child(child)
        child.queue_free()
    var last: Dictionary = state.get("economy", {}).get("lastPack", {})
    if last.is_empty():
        results.add_child(host.label(host.t("Паки пока не открывались", "No packs opened yet"), 20))
        return
    results.add_child(host.label(host.t("ПОСЛЕДНИЙ ПАК №%d", "LAST PACK #%d") % int(last.number), 22))
    for index in range(last.cards.size()):
        var card: Dictionary = host.game.card(Deck.card_id(last.cards[index]))
        var item: Label = host.label(str(index + 1) + ". " + str(card[host.language]) + " · " + host.t(host.Core.ELEMENTS_RU[int(card.element)], host.Core.ELEMENTS_EN[int(card.element)]), 20)
        item.name = "PackCard" + str(index)
        results.add_child(item)
    results.add_child(host.label(host.t("Списано: %d монет · Получено: %d пыли", "Spent: %d coins · Received: %d dust") % [last.price, last.dust], 18))

func purchase_pack() -> void:
    if busy or not host.profile.enabled:
        return
    if purchase.is_empty():
        if int(host.profile.state().wallet.gold) < Economy.PACK_PRICE:
            status.text = host.t("Недостаточно монет", "Not enough coins")
            refresh()
            return
        purchase = {"kind": "pack_buy", "entropy": Crypto.new().generate_random_bytes(32).hex_encode()}
    busy = true
    buy.disabled = true
    var committed: bool = host.profile.commit(purchase)
    busy = false
    if committed:
        purchase.clear()
        status.text = host.t("Пять результатов и оплата сохранены", "Five results and payment saved")
    else:
        status.text = host.t("Сохранение не подтверждено. Повтор использует тот же пак: ", "Save unconfirmed. Retry uses the same pack: ") + host.profile.error
    refresh()
