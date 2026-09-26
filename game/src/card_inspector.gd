extends AcceptDialog
## Explicit, keyboard-dismissible card details. Never writes a profile or edits a deck.
const Description = preload("res://src/card_description.gd")
var content: Label
var scroll: ScrollContainer
var origin: WeakRef
var current_id: int = -1

func _ready() -> void:
    name = "CardInspector"
    dialog_close_on_escape = true
    dialog_hide_on_ok = true
    get_ok_button().custom_minimum_size = Vector2(180, 64)
    get_ok_button().add_theme_font_size_override("font_size", 22)
    scroll = ScrollContainer.new()
    scroll.name = "DetailsScroll"
    scroll.custom_minimum_size = Vector2(220, 120)
    scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
    scroll.follow_focus = true
    add_child(scroll)
    content = Label.new()
    content.name = "CardDetailsText"
    content.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    content.add_theme_font_size_override("font_size", 23)
    scroll.add_child(content)
    visibility_changed.connect(_visibility_changed)

func open_card(id: int, language: String, source: Control = null) -> bool:
    var description: Dictionary = Description.describe(id, language)
    if description.is_empty() or not is_instance_valid(content):
        return false
    current_id = id
    origin = weakref(source) if source != null else null
    title = "О КАРТЕ" if language == "ru" else "CARD DETAILS"
    get_ok_button().text = "ЗАКРЫТЬ" if language == "ru" else "CLOSE"
    content.text = str(description.title) + "\n\n" + str(description.body)
    scroll.scroll_vertical = 0
    popup_centered_clamped(Vector2i(600, 780), 0.88)
    get_ok_button().grab_focus.call_deferred()
    return true

func _visibility_changed() -> void:
    if not visible:
        call_deferred("_restore_focus")

func _restore_focus() -> void:
    if visible or origin == null:
        return
    var control: Variant = origin.get_ref()
    origin = null
    if control != null and control.is_inside_tree() and not control.is_queued_for_deletion() and control.is_visible_in_tree():
        control.grab_focus()
