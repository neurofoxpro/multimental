extends RefCounted
## Reusable bounded page wrapper. Does not shrink text or change game rules.
static func wrap(content: VBoxContainer) -> ScrollContainer:
    var parent: Node = content.get_parent()
    var scroll := ScrollContainer.new()
    scroll.name = "PageScroll"
    scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
    scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
    scroll.follow_focus = true
    parent.remove_child(content)
    parent.add_child(scroll)
    content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    content.size_flags_vertical = Control.SIZE_EXPAND_FILL
    scroll.add_child(content)
    return scroll
