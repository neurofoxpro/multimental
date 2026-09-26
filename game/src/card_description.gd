extends RefCounted
## Read-only presentation of accepted combat rules, not a second combat engine.
const Core = preload("res://src/match_core.gd")
const Feedback = preload("res://src/combat_feedback.gd")
const AREAS: Array = [
    ["Одна соседняя клетка впереди.", "One adjacent cell in front."],
    ["Соседние клетки впереди, слева и справа.", "Adjacent cells in front, left and right."],
    ["До двух клеток впереди. Первый юнит закрывает следующего.", "Up to two cells in front. The first unit blocks the next."],
    ["До двух клеток впереди. Стреляет и через промежуточного юнита.", "Up to two cells in front, including past an intervening unit."],
    ["Две соседние диагонали впереди.", "The two adjacent forward diagonals."]
]

static func describe(id: int, language: String = "ru") -> Dictionary:
    if id < 0 or id >= Core.CARD_COUNT or language not in ["ru", "en"]:
        return {}
    var card: Dictionary = Core.new().card(id)
    var index: int = 0 if language == "ru" else 1
    var heading: String = str(card[language])
    var element: String = Core.ELEMENTS_RU[int(card.element)] if index == 0 else Core.ELEMENTS_EN[int(card.element)]
    var role: String = Core.TYPES_RU[int(card.role)] if index == 0 else Core.TYPES_EN[int(card.role)]
    var stats: String = ("Стоимость: %d мон. · Атака: %d · Здоровье: %d" if index == 0 else "Cost: %d coins · Attack: %d · Health: %d") % [card.cost, card.attack, card.health]
    var combat: String = "Первый удар по всем целям, включая союзников. Отвечают только выжившие враги, направленные на атакующего." if index == 0 else "First strike hits all targets, including allies. Only surviving enemies facing the attacker retaliate."
    var action: String = "Перед размещением карту можно повернуть. Новый юнит атакует бесплатно; ранее выставленный — за 1 монету." if index == 0 else "Rotate before placement. A newly placed unit attacks for free; an older unit costs 1 coin to attack."
    var terrain: String = "Совпадение стихии с клеткой даёт +1 здоровья при размещении." if index == 0 else "Matching the cell element grants +1 health when placed."
    return {"id": id, "title": heading, "body": element + " · " + role + "\n\n" + stats + "\n\n" + str(AREAS[int(card.role)][index]) + " " + Feedback.pattern(card, 0) + "\n\n" + action + "\n\n" + combat + "\n\n" + terrain, "rules": Core.RULES_ID}
