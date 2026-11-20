extends SceneTree
## The production 30-card accepted set has no illustrations. The procedural fallback must stay usable.
const CardArt = preload("res://src/card_art.gd")
const Approved = preload("res://src/card_art_catalog.gd")
var checks: int = 0
var failures: int = 0

func check(ok: bool, description: String) -> void:
    checks += 1
    if not ok:
        failures += 1
        printerr("CARD_ART_UI_FAIL " + description)

func _initialize() -> void:
    call_deferred("test_card_art")

func test_card_art() -> void:
    for id in range(30):
        check(Approved.entry(id).is_empty(), "none keeps empty whitelist " + str(id))
        check(CardArt.texture_for(id) == null, "none uses fallback " + str(id))
    check(Approved.entry(-1).is_empty(), "negative card cannot load art")
    check(Approved.entry(30).is_empty(), "unaccepted card cannot load art")
    var ui = load("res://src/main.tscn").instantiate()
    ui.profile.enabled = false
    root.add_child(ui)
    ui.set_process(false)
    ui.start_match(true)
    for frame in range(3):
        await process_frame
    var before: String = ui.game.digest()
    for child in ui.hand_row.get_children():
        check(child.emblem.visible and not child.art_view.visible, "hand icon fallback")
        check(child.art_view.texture == null, "hand has no unapproved raster")
    check(ui.battle_inspector.open_card(0, "ru"), "card inspector opens")
    check(not ui.battle_inspector.art_view.visible, "inspector hides absent art")
    check(ui.battle_inspector.content.text.length() > 0, "inspector text remains independent")
    check(ui.game.digest() == before, "art and card inspection do not mutate rules")
    ui.battle_inspector.hide()
    ui.show_menu()
    ui.queue_free()
    for frame in range(3):
        await process_frame
    if failures == 0:
        print("MULTIMENTAL_CARD_ART_UI_PASS checks=" + str(checks))
    quit(0 if failures == 0 else 1)
