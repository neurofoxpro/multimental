class_name ElementMark
extends RefCounted
## Shared, shape-distinct icons; indexes follow MatchCore.ELEMENTS.
const SYMBOLS: Array[String] = ["♨", "≈", "ϟ", "≋", "◆", "☼", "☾", "⚙", "☣", "✧"]
static func symbol(index: int) -> String:
    return SYMBOLS[index] if index >= 0 and index < SYMBOLS.size() else "?"
