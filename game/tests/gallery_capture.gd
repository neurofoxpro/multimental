extends SceneTree
## Actual rendered source previews in a private fixture, never desktop/phone screenshots.
var captured: Array[Dictionary] = []
var nonce: String = ""
var output: String = ""
var viewport: SubViewport
var ui
var personal_before: Array[String] = []
const PAGES: Array[String] = ["menu", "collection", "card", "battle", "shop", "crafting", "rewards", "connection", "rules", "settings"]
func _initialize() -> void:
    call_deferred("run_capture")
func hashes() -> Array[String]:
    var result: Array[String] = []
    for file in ["user://profile/a.json", "user://profile/b.json", "user://settings.cfg"]:
        result.append(FileAccess.get_sha256(file) if FileAccess.file_exists(file) else "")
    return result
func fail(reason: String) -> void:
    printerr("GALLERY_CAPTURE_FAIL " + reason)
    quit(1)
func fixture() -> bool:
    if not ui.ensure_collection():
        return false
    if not ui.profile.commit({"kind": "economy_init"}):
        return false
    if not ui.profile.commit({"kind": "pack_buy", "entropy": "gallery-pack-v1".sha256_text()}):
        return false
    for number in range(1, 4):
        var command: Dictionary = {"kind": "reward_match", "policy": preload("res://src/rewards_policy.gd").POLICY, "matchNumber": number, "outcome": "win" if number < 3 else "loss", "day": ui.rewards_day(), "replay": {"rules": "gallery-fixture", "session": "gallery-" + str(number), "commands": []}}
        if not ui.profile.commit(command):
            return false
    return true
func show_page(page: String) -> bool:
    ui.battle = false
    ui.online = false
    match page:
        "menu": ui.show_menu()
        "collection": ui.show_collection()
        "card":
            ui.show_collection()
            await process_frame
            var editor = ui.find_child("CollectionScreen", true, false)
            if editor == null or not editor.inspector.open_card(21, ui.language):
                return false
        "battle":
            ui.start_match(true)
            ui.game.start(42)
            for action in range(12):
                if ui.game.state.winner != -1:
                    break
                ui.game.apply(int(ui.game.state.active), ui.game.choose_ai())
            ui.refresh()
        "shop": ui.show_shop()
        "crafting":
            ui.show_crafting()
            var screen = ui.find_child("CraftingScreen", true, false)
            if screen == null:
                return false
            screen.picker.select(21)
            screen.refresh()
        "rewards": ui.show_rewards()
        "connection":
            ui.show_lan_menu()
            # No host/join call: replace the enumerated address with a public documentation fixture.
            ui.network_addresses.clear()
            ui.network_addresses.add_item("Example LAN · 192.0.2.1")
            ui.network_addresses.set_item_metadata(0, "192.0.2.1")
            ui.invite_input.text = ""
        "rules": ui.show_card_guide()
        "settings": ui.show_audio_settings()
        _: return false
    return true
func take(page: String, locale: String, size: Vector2i) -> bool:
    viewport.size = size
    ui.language = locale
    if not await show_page(page):
        return false
    await process_frame
    await process_frame
    if page == "menu":
        var play: Button = ui.find_child("PlayAI", true, false)
        var menu_scroll: ScrollContainer = ui.root.get_parent()
        play.grab_focus()
        menu_scroll.ensure_control_visible(play)
        await process_frame
        await process_frame
        menu_scroll.scroll_vertical = 0
        await process_frame
        if not ui.get_viewport_rect().encloses(play.get_global_rect()):
            return false
    await create_timer(0.8 if page == "battle" else 0.12).timeout
    await RenderingServer.frame_post_draw
    if ui.get_viewport_rect().size != Vector2(size):
        return false
    var image: Image = viewport.get_texture().get_image()
    if image == null or image.is_empty() or image.get_size() != size:
        return false
    var colors: Dictionary = {}
    for y in range(0, size.y, 12):
        for x in range(0, size.x, 12):
            colors[image.get_pixel(x, y).to_rgba32()] = true
    if colors.size() < 8:
        return false
    var id: String = locale + "-" + page + "-" + str(size.x) + "x" + str(size.y)
    var filename: String = output.path_join(id + ".png")
    if FileAccess.file_exists(filename) or image.save_png(filename) != OK:
        return false
    captured.append({"id": id, "page": page, "locale": locale, "width": size.x, "height": size.y, "file": id + ".png", "sha256": FileAccess.get_sha256(filename), "sampledColors": colors.size()})
    return true
func run_capture() -> void:
    var args: PackedStringArray = OS.get_cmdline_user_args()
    if args.size() != 1 or args[0].length() != 32 or DisplayServer.get_name() == "headless":
        fail("renderer_and_unique_nonce_required")
        return
    nonce = args[0]
    for c in nonce:
        if not c in "0123456789abcdef":
            fail("invalid_nonce")
            return
    output = ProjectSettings.globalize_path("res://../.gameprod/evidence/gallery/" + nonce)
    if not DirAccess.dir_exists_absolute(output):
        fail("runner_owned_directory_missing")
        return
    personal_before = hashes()
    root.size = Vector2i(120, 120)
    root.title = "Multimental · source capture"
    viewport = SubViewport.new()
    viewport.size = Vector2i(720, 1280)
    viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
    viewport.gui_embed_subwindows = true
    root.add_child(viewport)
    var folder: String = "user://profile-tests/gallery-" + nonce
    ui = load("res://src/main.tscn").instantiate()
    ui.profile_directory = folder
    ui.profile_legacy_settings = ""
    viewport.add_child(ui)
    ui.set_process(false)
    await process_frame
    if not fixture():
        fail("isolated_profile_fixture_failed")
        return
    for locale in ["ru", "en"]:
        for page in PAGES:
            if not await take(page, locale, Vector2i(720, 1280)):
                fail("capture_failed_" + locale + "_" + page)
                return
        for page in ["menu", "battle"]:
            if not await take(page, locale, Vector2i(1280, 720)):
                fail("landscape_failed_" + locale + "_" + page)
                return
    ui.battle = false
    ui.queue_free()
    await process_frame
    viewport.queue_free()
    await process_frame
    if hashes() != personal_before:
        fail("personal_profile_or_settings_changed")
        return
    for name in ["a.json", "b.json"]:
        if FileAccess.file_exists(folder.path_join(name)):
            DirAccess.remove_absolute(folder.path_join(name))
    DirAccess.remove_absolute(folder)
    print("MULTIMENTAL_GALLERY_JSON " + JSON.stringify({"schemaVersion": 1, "nonce": nonce, "renderer": DisplayServer.get_name(), "engine": Engine.get_version_info().string, "sourcePreview": true, "installedApkCapture": false, "personalProfileUntouched": true, "buildStamp": {"version": BuildInfo.VERSION, "commit": BuildInfo.COMMIT}, "fixtures": ["isolated full alpha collection", "one deterministic pack", "three API match results, not played games", "battle seed42 with12 API actions", "LAN address replaced by documentation example192.0.2.1; no room joined"], "images": captured}))
    print("MULTIMENTAL_GALLERY_PASS images=" + str(captured.size()))
    quit(0 if captured.size() == 24 else 1)
