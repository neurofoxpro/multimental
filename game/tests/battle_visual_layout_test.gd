extends SceneTree
const Fixture = preload("res://tests/support/battle_gallery_fixture.gd")
var checks: int = 0
var failures: int = 0
func check(ok: bool, name: String) -> void:
    checks += 1
    if not ok:
        failures += 1
        printerr("BATTLE_LAYOUT_FAIL "+name)
func width_of(node: Control, value: String) -> float:
    return node.get_theme_font("font").get_string_size(value,HORIZONTAL_ALIGNMENT_LEFT,-1,node.get_theme_font_size("font_size")).x
func _initialize() -> void:
    call_deferred("run_test")
func settle() -> void:
    for i in range(5):
        await process_frame
func run_test() -> void:
    root.gui_embed_subwindows = true
    var ui = load("res://src/main.tscn").instantiate()
    ui.profile.enabled = false
    root.add_child(ui)
    ui.set_process(false)
    for viewport in [Vector2i(720,1280),Vector2i(1280,720),Vector2i(960,540)]:
        root.content_scale_size = viewport
        root.size = viewport
        for locale in ["ru","en"]:
            ui.language = locale
            check(Fixture.show(ui,"battle-unit"),"selected unit fixture")
            await settle()
            var cancel: Button = ui.find_child("CancelSelection",true,false)
            var padding: float = cancel.get_theme_stylebox("normal").get_minimum_size().x
            check(width_of(cancel,cancel.text)+padding <= cancel.size.x+1,"cancel caption fits one line "+locale+str(viewport))
            for index in [0,1,2]:
                var cell = ui.board_buttons[index]
                check(width_of(cell.header,cell.header.text) <= cell.header.size.x+1,"full owner/ally/target caption "+locale+str(viewport)+str(index))
                if cell.terrain_label.visible:
                    check(cell.header.get_rect().end.x <= cell.terrain_label.position.x,"owner and terrain do not overlap")
            ui.attack_selected()
            await settle()
            check(ui.friendly_confirm.visible,"ally warning opens")
            var button: Button = ui.friendly_confirm.get_ok_button()
            var inner: float = button.size.x-button.get_theme_stylebox("normal").get_minimum_size().x
            for word in button.text.split(" "):
                check(width_of(button,word) <= inner+1,"confirmation word stays intact: "+word)
            var border = ui.friendly_confirm.get_theme_stylebox("embedded_border")
            check(border is StyleBoxFlat and border.expand_margin_top >= 32,"opaque title backing covers embedded warning title")
            check(ui.game.commands.is_empty(),"layout and warnings submit nothing")
            ui.cancel_friendly_attack()
    ui.show_menu()
    ui.queue_free()
    await settle()
    print("MULTIMENTAL_BATTLE_VISUAL_LAYOUT_RESULT checks="+str(checks)+" failures="+str(failures))
    if failures == 0:
        print("MULTIMENTAL_BATTLE_VISUAL_LAYOUT_PASS locales=2 viewports=3")
    quit(0 if failures == 0 else 1)
