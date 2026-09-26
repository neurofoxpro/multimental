extends SceneTree
const Description = preload("res://src/card_description.gd")
const Core = preload("res://src/match_core.gd")
var failures: int = 0
var checks: int = 0

func check(value: bool, message: String) -> void:
    checks += 1
    if not value:
        failures += 1
        print("CARD_INSPECTOR_FAIL " + message)

func _initialize() -> void:
    call_deferred("run_test")

func run_test() -> void:
    root.gui_embed_subwindows = true
    root.content_scale_size = Vector2i(720, 1280)
    root.size = Vector2i(720, 1280)
    for id in range(Core.CARD_COUNT):
        var card: Dictionary = Core.new().card(id)
        for locale in ["ru", "en"]:
            var text: Dictionary = Description.describe(id, locale)
            check(text.title == card[locale], "canonical localized title")
            check(text.body.contains(str(card.attack)) and text.body.contains(str(card.health)), "canonical numbers")
            check(text.rules == Core.RULES_ID and text.body.length() > 150, "complete rule-bound explanation")
    for bad in [-1, Core.CARD_COUNT, 1000000]:
        check(Description.describe(bad).is_empty(), "unknown card has no fabricated details")
    check(Description.describe(0, "invalid").is_empty(), "invalid language rejected")
    var directory: String = "user://profile-tests/inspector-" + Crypto.new().generate_random_bytes(12).hex_encode()
    var ui = load("res://src/main.tscn").instantiate()
    ui.profile_directory = directory
    ui.profile_legacy_settings = ""
    root.add_child(ui)
    ui.set_process(false)
    ui.show_collection()
    await process_frame
    await process_frame
    var editor = ui.find_child("CollectionScreen", true, false)
    var source: Button = editor.find_child("Details_c000", true, false)
    check(source != null and source.focus_mode == Control.FOCUS_ALL, "explicit focusable details control")
    var before: Dictionary = ui.profile.state().duplicate(true)
    editor.change_card("c000", -1)
    var draft: Array = editor.draft_cards.duplicate()
    source = editor.find_child("Details_c000", true, false)
    source.grab_focus()
    source.pressed.emit()
    await process_frame
    await process_frame
    var inspector = editor.inspector
    check(inspector.visible and inspector.current_id == 0, "opens selected card")
    check(inspector.content.text.contains("Искра") and inspector.content.text.contains("союзников"), "Russian text explains friendly fire")
    check(inspector.get_ok_button().has_focus(), "close receives keyboard focus")
    check(editor.is_dirty() and editor.draft_cards == draft and ui.profile.state() == before, "reading details preserves unsaved edits and profile")
    inspector.get_ok_button().pressed.emit()
    await process_frame
    await process_frame
    check(not inspector.visible and source.has_focus(), "close returns focus to its source")
    for viewport_size in [Vector2i(720, 1280), Vector2i(720, 1440), Vector2i(1280, 720), Vector2i(360, 640)]:
        root.content_scale_size = viewport_size
        root.size = viewport_size
        await process_frame
        check(Vector2i(ui.get_viewport_rect().size) == viewport_size, "measured logical viewport equals requested size")
        for locale in ["ru", "en"]:
            check(inspector.open_card(28, locale, source), "open long card name")
            await process_frame
            await process_frame
            check(inspector.size.x <= root.size.x and inspector.size.y <= root.size.y, "dialog stays inside viewport")
            check(inspector.scroll.horizontal_scroll_mode == ScrollContainer.SCROLL_MODE_DISABLED, "no horizontal reading scroll")
            check(inspector.get_ok_button().size.x >= 260 and inspector.get_ok_button().size.y >= 96, "actual close target retains intended minimum after dialog layout")
            check(inspector.get_ok_button().get_global_rect().end.y <= inspector.size.y, "close remains in visible dialog")
            check(inspector.content.text.begins_with(str(Core.new().card(28)[locale])), "selected identity and language stay exact")
            inspector.hide()
            await process_frame
    root.content_scale_size = Vector2i(720, 1280)
    root.size = Vector2i(720, 1280)
    inspector.open_card(1, "en", source)
    await process_frame
    var escape := InputEventKey.new()
    escape.keycode = KEY_ESCAPE
    escape.pressed = true
    root.push_input(escape)
    await process_frame
    await process_frame
    check(not inspector.visible, "Escape dismisses details without modifying draft")
    check(ui.profile.state() == before and editor.draft_cards == draft, "keyboard dismissal has no data effects")
    check(not inspector.open_card(-1, "ru", source), "invalid card does not open")
    inspector.open_card(0, "ru", source)
    editor.search.text = "несуществующая карта"
    editor.search.text_changed.emit(editor.search.text)
    await process_frame
    inspector.hide()
    await process_frame
    check(not inspector.visible, "destroyed opener does not cause a stale focus call")
    ui.language = "en"
    ui.show_crafting()
    await process_frame
    var crafting = ui.find_child("CraftingScreen", true, false)
    crafting.picker.select(21)
    crafting.details_button.pressed.emit()
    await process_frame
    await process_frame
    check(crafting.inspector.visible and crafting.inspector.current_id == 21, "same inspector reused by crafting")
    check(crafting.inspector.content.text.contains("Deep Guardian"), "crafting shows selected not previous card")
    check(ui.profile.state() == before and crafting.pending.is_empty(), "inspection does not craft recycle or spend")
    crafting.inspector.hide()
    await process_frame
    ui.queue_free()
    await process_frame
    if failures == 0:
        for filename in ["a.json", "b.json"]:
            DirAccess.remove_absolute(directory.path_join(filename))
        DirAccess.remove_absolute(directory)
        print("MULTIMENTAL_CARD_INSPECTOR_PASS checks=" + str(checks))
    quit(0 if failures == 0 else 1)
