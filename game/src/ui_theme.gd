extends RefCounted
## Shared visual tokens. Logical Godot units, not a claim about Android dp.
const BACKGROUND: Color = Color("091322")
const SURFACE: Color = Color("1b304b")
const TEXT: Color = Color("f1f6fc")
const MUTED: Color = Color("c4d2e5")
const ACCENT: Color = Color("8cddbd")
const FOCUS: Color = Color("ffe09a")

static func box(background: Color, border: Color = Color("3e5773")) -> StyleBoxFlat:
    var result := StyleBoxFlat.new()
    result.bg_color = background
    result.border_color = border
    result.set_border_width_all(1)
    result.set_corner_radius_all(12)
    result.content_margin_left = 12
    result.content_margin_right = 12
    result.content_margin_top = 8
    result.content_margin_bottom = 8
    return result

static func focus_box() -> StyleBoxFlat:
    var result: StyleBoxFlat = box(Color.TRANSPARENT, FOCUS)
    result.draw_center = false
    result.set_border_width_all(3)
    return result

static func build() -> Theme:
    var result := Theme.new()
    result.default_font_size = 20
    for type in ["Button", "OptionButton", "LineEdit", "TextEdit"]:
        result.set_color("font_color", type, TEXT)
        result.set_color("font_disabled_color", type, MUTED)
        result.set_color("font_uneditable_color", type, MUTED)
        result.set_color("font_placeholder_color", type, MUTED)
        result.set_stylebox("normal", type, box(SURFACE))
        result.set_stylebox("hover", type, box(Color("294762")))
        result.set_stylebox("pressed", type, box(Color("33536d"), ACCENT))
        result.set_stylebox("disabled", type, box(Color("14263a")))
        result.set_stylebox("read_only", type, box(Color("14263a")))
        result.set_stylebox("focus", type, focus_box())
    result.set_color("font_color", "Label", TEXT)
    result.set_stylebox("panel", "PanelContainer", box(Color("122237")))
    result.set_stylebox("panel", "AcceptDialog", box(Color("13243a"), Color("577592")))
    result.set_stylebox("embedded_border", "Window", box(Color("13243a"), Color("577592")))
    result.set_color("title_color", "Window", TEXT)
    return result

static func decorate_button(node: Button, primary: bool = false) -> void:
    node.focus_mode = Control.FOCUS_ALL
    node.clip_text = true
    node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    node.add_theme_stylebox_override("normal", box(Color("214e48") if primary else SURFACE, ACCENT if primary else Color("3e5773")))
    node.add_theme_stylebox_override("hover", box(Color("315e53") if primary else Color("294762"), ACCENT))
    node.add_theme_stylebox_override("pressed", box(Color("3b655b") if primary else Color("33536d"), ACCENT))
    node.add_theme_stylebox_override("disabled", box(Color("14263a")))
    node.add_theme_stylebox_override("focus", focus_box())
    for key in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
        node.add_theme_color_override(key, TEXT)
    node.add_theme_color_override("font_disabled_color", MUTED)

static func decorate_dialog(dialog: AcceptDialog, minimum_width: int = 120, minimum_height: int = 70) -> void:
    dialog.theme = build()
    dialog.add_theme_constant_override("buttons_min_width", minimum_width)
    dialog.add_theme_constant_override("buttons_min_height", minimum_height)
    dialog.add_theme_constant_override("buttons_separation", 12)
    decorate_button(dialog.get_ok_button())
    if dialog is ConfirmationDialog:
        decorate_button(dialog.get_cancel_button())

static func hand_card(node: Button, element: Color, selected: bool) -> void:
    node.modulate = Color.WHITE
    node.autowrap_mode = TextServer.AUTOWRAP_OFF
    var style: StyleBoxFlat = box(element.darkened(0.86), ACCENT if selected else element)
    style.set_border_width_all(3 if selected else 2)
    for state in ["normal", "hover", "pressed", "disabled"]:
        node.add_theme_stylebox_override(state, style)
    node.add_theme_color_override("font_disabled_color", MUTED)

static func luminance(color: Color) -> float:
    var linear: Color = color.srgb_to_linear()
    return 0.2126 * linear.r + 0.7152 * linear.g + 0.0722 * linear.b

static func contrast(a: Color, b: Color) -> float:
    return (maxf(luminance(a), luminance(b)) + 0.05) / (minf(luminance(a), luminance(b)) + 0.05)
