extends Container
## Keeps the board and footer stable; only the action panel may scroll on short windows.
var board: AspectRatioContainer
var scroll: ScrollContainer
var panel: VBoxContainer
var landscape: bool = false
const GAP: float = 12.0
const BOARD_MIN: float = 280.0

func setup() -> void:
    name = "BattleLayout"
    size_flags_horizontal = Control.SIZE_EXPAND_FILL
    size_flags_vertical = Control.SIZE_EXPAND_FILL
    board = AspectRatioContainer.new()
    board.name = "BattleBoard"
    board.ratio = 1.0
    board.stretch_mode = AspectRatioContainer.STRETCH_FIT
    add_child(board)
    scroll = ScrollContainer.new()
    scroll.name = "BattleActionScroll"
    scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
    scroll.follow_focus = true
    add_child(scroll)
    panel = VBoxContainer.new()
    panel.name = "BattleActions"
    panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    panel.add_theme_constant_override("separation", 8)
    scroll.add_child(panel)
    panel.minimum_size_changed.connect(queue_sort)
    queue_sort()

func _get_minimum_size() -> Vector2:
    return Vector2(BOARD_MIN, BOARD_MIN)

func _notification(what: int) -> void:
    if what != NOTIFICATION_SORT_CHILDREN or not is_instance_valid(board) or size.x <= 0 or size.y <= 0:
        return
    landscape = size.x >= 600 and size.x > size.y * 1.15
    var side: float
    if landscape:
        side = floor(minf(size.y, size.x - 280.0 - GAP))
        fit_child_in_rect(board, Rect2(Vector2(0, (size.y - side) / 2), Vector2(side, side)))
        fit_child_in_rect(scroll, Rect2(Vector2(side + GAP, 0), Vector2(maxf(0, size.x - side - GAP), size.y)))
    else:
        var desired_actions: float = maxf(260, panel.get_combined_minimum_size().y)
        side = floor(minf(size.x, maxf(BOARD_MIN, size.y - desired_actions - GAP)))
        fit_child_in_rect(board, Rect2(Vector2((size.x - side) / 2, 0), Vector2(side, side)))
        fit_child_in_rect(scroll, Rect2(Vector2(0, side + GAP), Vector2(size.x, maxf(0, size.y - side - GAP))))
