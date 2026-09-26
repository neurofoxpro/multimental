extends RefCounted
const Core = preload("res://src/match_core.gd")
const Deck = preload("res://src/deck_rules.gd")

static func rows(profile: Dictionary, query: String = "", element: int = -1) -> Array[Dictionary]:
    var result: Array[Dictionary] = []
    if query.length() > 80 or element < -1 or element >= Core.ELEMENTS.size():
        return result
    var needle: String = query.strip_edges().to_lower()
    var core = Core.new()
    var inventory: Dictionary = profile.get("inventory", {})
    for id in range(Core.CARD_COUNT):
        var card: Dictionary = core.card(id)
        if element >= 0 and int(card.element) != element:
            continue
        var searchable: String = str(card.ru) + " " + str(card.en) + " " + Core.ELEMENTS_RU[int(card.element)] + " " + Core.ELEMENTS_EN[int(card.element)] + " " + Core.TYPES_RU[int(card.role)] + " " + Core.TYPES_EN[int(card.role)]
        if not needle.is_empty() and not searchable.to_lower().contains(needle):
            continue
        card.code = Deck.code(id)
        card.owned = int(inventory.get(card.code, 0))
        result.append(card)
    return result
