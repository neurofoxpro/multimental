extends RefCounted
## Generated only from the accepted card catalog. Presentation, not match rules.
const ROWS: Array[Dictionary] = [
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {}
]

static func entry(id: int) -> Dictionary:
    return ROWS[id].duplicate(true) if id >= 0 and id < ROWS.size() else {}
