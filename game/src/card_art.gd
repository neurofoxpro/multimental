extends RefCounted
## Load only checked, accepted local art. Missing or damaged assets use the existing procedural emblem.
const Catalog = preload("res://src/card_art_catalog.gd")

static func texture_for(id: int) -> Texture2D:
    var entry: Dictionary = Catalog.entry(id)
    if entry.is_empty():
        return null
    var source: String = str(entry.get("path", ""))
    var expected: String = str(entry.get("sha256", ""))
    if not source.begins_with("res://assets/cards/") or source.find("..") != -1:
        return null
    if not (source.ends_with(".png") or source.ends_with(".webp")) or expected.length() != 64:
        return null
    if FileAccess.get_sha256(source) != expected:
        return null
    if not ResourceLoader.exists(source, "Texture2D"):
        return null
    var loaded: Resource = ResourceLoader.load(source, "Texture2D")
    return loaded as Texture2D if loaded is Texture2D else null
