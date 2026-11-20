extends RefCounted
## Pure start-screen readiness. No profile mutations or network access.
const Deck = preload("res://src/deck_rules.gd")

static func inspect(state: Dictionary) -> Dictionary:
    var meta: Dictionary = state.get("collection", {})
    if meta.is_empty():
        return {"ready": true, "starter": true, "name": "", "count": Deck.SIZE, "reason": ""}
    var selected: String = str(meta.get("selected", ""))
    var decks: Dictionary = state.get("decks", {})
    if selected.is_empty() or not decks.has(selected):
        return {"ready": false, "starter": false, "name": "", "count": 0, "reason": "NO_SELECTED_DECK"}
    var cards: Variant = decks[selected]
    var count: int = cards.size() if cards is Array else 0
    var checked: Dictionary = Deck.validate_codes(cards, state.get("inventory", {}))
    return {
        "ready": bool(checked.ok) and bool(checked.get("ready", false)),
        "starter": false,
        "name": str(meta.get("names", {}).get(selected, selected)),
        "count": count,
        "reason": str(checked.get("code", ""))
    }
