extends SceneTree
## Regression for actual shaped catalog names, not just label rectangle geometry.
var checks: int = 0
var failures: int = 0
func check(ok: bool, label: String) -> void:
    checks += 1
    if not ok:
        failures += 1
        printerr("READABILITY_FAIL " + label)
func _initialize() -> void:
    call_deferred("run_test")
func run_test() -> void:
    root.size = Vector2i(1280,720)
    var ui = load("res://src/main.tscn").instantiate()
    ui.profile.enabled = false
    root.add_child(ui)
    ui.set_process(false)
    ui.start_match(true)
    var tile = preload("res://src/battle_tile.gd").new()
    tile.theme = ui.theme
    tile.setup(ui,0)
    root.add_child(tile)
    var view: Dictionary = ui._view()
    view.center_unlocked = true
    view.legal = []
    for side in [145,156,173,221,320]:
        tile.size = Vector2(side,side)
        for locale in ["ru","en"]:
            ui.language = locale
            for id in range(ui.Core.CARD_COUNT):
                var definition: Dictionary = ui.game.card(id)
                view.board[0] = {"id":id,"owner":0,"attack":definition.attack,"health":definition.health,"direction":0}
                tile.present(ui,view,0,[],false)
                await process_frame
                await process_frame
                var title: Label = tile.title_label
                var key: String = locale + "/" + str(side) + "/" + str(id) + " " + title.text
                check(title.text == str(definition[locale]),"full catalog name " + key)
                check(title.visible and title.get_visible_line_count() == title.get_line_count(),"all shaped lines visible " + key + " lines=" + str(title.get_line_count()) + " shown=" + str(title.get_visible_line_count()))
                check(title.position.y + title.size.y <= tile.stats.position.y - 3,"name does not overlap stats " + key)
                check(tile.emblem.position.y + tile.emblem.size.y <= title.position.y - 3,"emblem does not overlap name " + key)
                check(Rect2(Vector2.ZERO,tile.size).encloses(title.get_rect()),"title stays inside tile " + key)
    tile.queue_free()
    ui.show_menu()
    ui.queue_free()
    await process_frame
    print("MULTIMENTAL_READABILITY_RESULT checks=" + str(checks) + " failures=" + str(failures))
    if failures == 0:
        print("MULTIMENTAL_READABILITY_PASS locales=2 catalog=30 tile_sizes=5")
    quit(0 if failures == 0 else 1)
