extends GridContainer
## Change only presentation columns. Actions and keyboard focus keep their identity.
func _ready() -> void:
    name = "ActionGrid"
    size_flags_horizontal = Control.SIZE_EXPAND_FILL
    add_theme_constant_override("h_separation", 12)
    add_theme_constant_override("v_separation", 10)
    resized.connect(_adapt)
    _adapt()
func _adapt() -> void:
    columns = 2 if size.x >= 520 else 1
