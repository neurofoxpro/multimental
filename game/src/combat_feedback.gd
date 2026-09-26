class_name CombatFeedback
extends RefCounted
## Presentation only: arrows and damage feedback cannot mutate the match.
const ARROWS: Array[String] = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"]

static func pattern(definition: Dictionary, direction: int) -> String:
    var front: int = posmod(direction, 4) * 2
    var text: String = ARROWS[front]
    if definition.kind == "guard":
        text = ARROWS[posmod(front - 2, 8)] + " " + text + " " + ARROWS[posmod(front + 2, 8)]
    elif definition.kind == "flanker":
        text = ARROWS[posmod(front - 1, 8)] + " " + ARROWS[posmod(front + 1, 8)]
    if definition.kind in ["lancer", "archer"]:
        text += " ×2"
    return text

static func show_damage(button: Control, amount: int) -> void:
    if not is_instance_valid(button) or not button.is_inside_tree() or amount <= 0:
        return
    var flash := ColorRect.new()
    flash.name = "DamageFlash"
    flash.color = Color(1.0, 0.2, 0.15, 0.4)
    flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
    flash.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    flash.z_index = 9
    button.add_child(flash)
    var fade := flash.create_tween()
    fade.tween_property(flash, "color:a", 0.0, 0.32)
    fade.tween_callback(flash.queue_free)
    var number := Label.new()
    number.name = "DamageNumber"
    number.text = "−%d" % amount
    number.add_theme_font_size_override("font_size", 32)
    number.add_theme_color_override("font_color", Color("ffb0a0"))
    number.add_theme_color_override("font_outline_color", Color("160c10"))
    number.add_theme_constant_override("outline_size", 5)
    number.mouse_filter = Control.MOUSE_FILTER_IGNORE
    number.z_index = 10
    button.add_child(number)
    number.position = button.size * 0.5 - Vector2(24, 20)
    var tween := number.create_tween().set_parallel(true)
    tween.tween_property(number, "position:y", number.position.y - 44.0, 0.7)
    tween.tween_property(number, "modulate:a", 0.0, 0.7)
    tween.chain().tween_callback(number.queue_free)

static func show_unlock(button: Control, text: String) -> void:
    if not is_instance_valid(button) or not button.is_inside_tree():
        return
    var flash := ColorRect.new()
    flash.name = "CenterUnlockFlash"
    flash.color = Color(0.3, 1.0, 0.75, 0.55)
    flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
    flash.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    button.add_child(flash)
    flash.create_tween().tween_property(flash, "color:a", 0.0, 1.1)
    var banner := Label.new()
    banner.name = "CenterUnlockBanner"
    banner.text = text
    banner.add_theme_font_size_override("font_size", 17)
    banner.add_theme_color_override("font_outline_color", Color.BLACK)
    banner.add_theme_constant_override("outline_size", 4)
    banner.mouse_filter = Control.MOUSE_FILTER_IGNORE
    banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    banner.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    flash.add_child(banner)
    var tween := flash.create_tween()
    tween.tween_interval(1.4)
    tween.tween_property(flash, "modulate:a", 0.0, 0.4)
    tween.tween_callback(flash.queue_free)
