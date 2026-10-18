class_name AudioDirector
extends Node
const DEFAULTS: Dictionary = {"master": 0.8, "music": 0.35, "effects": 0.6}
var settings: Dictionary = DEFAULTS.duplicate()
var settings_path: String = "user://audio.cfg"
var music: AudioStreamPlayer
var effects: AudioStreamPlayer
var debounce: Timer
var last_save_ok: bool = true
static func valid(value: Variant) -> bool:
    if not value is Dictionary or value.size() != 3:
        return false
    for key in DEFAULTS:
        if not value.has(key) or typeof(value[key]) not in [TYPE_FLOAT, TYPE_INT] or not is_finite(float(value[key])) or value[key] < 0 or value[key] > 1:
            return false
    return true
func _ready() -> void:
    load_settings()
    music = AudioStreamPlayer.new()
    effects = AudioStreamPlayer.new()
    var ambient: AudioStreamWAV = load("res://audio/ambient.wav").duplicate()
    ambient.loop_mode = AudioStreamWAV.LOOP_FORWARD
    ambient.loop_begin = 0
    ambient.loop_end = int(ambient.data.size() / 2)
    music.stream = ambient
    effects.stream = load("res://audio/action.wav")
    add_child(music)
    add_child(effects)
    debounce = Timer.new()
    debounce.one_shot = true
    debounce.wait_time = 0.4
    debounce.timeout.connect(flush)
    add_child(debounce)
    apply_volumes()
    if DisplayServer.get_name() != "headless":
        music.play()
func load_settings() -> void:
    var file := ConfigFile.new()
    if file.load(settings_path) != OK:
        return
    var candidate: Dictionary = {}
    for key in DEFAULTS:
        candidate[key] = file.get_value("volume", key, DEFAULTS[key])
    if valid(candidate):
        settings = candidate
func set_volume(category: String, value: float) -> bool:
    if not DEFAULTS.has(category) or not is_finite(value) or value < 0 or value > 1:
        return false
    settings[category] = value
    apply_volumes()
    if debounce != null:
        debounce.start()
    return true
func apply_volumes() -> void:
    if music == null or effects == null:
        return
    var a: float = float(settings.master) * float(settings.music)
    var b: float = float(settings.master) * float(settings.effects)
    music.volume_db = -80.0 if a <= 0 else linear_to_db(a)
    effects.volume_db = -80.0 if b <= 0 else linear_to_db(b)
func play_action() -> void:
    if effects != null and float(settings.master) * float(settings.effects) > 0 and DisplayServer.get_name() != "headless":
        effects.play()
func flush() -> void:
    if debounce != null:
        debounce.stop()
    var file := ConfigFile.new()
    for key in settings:
        file.set_value("volume", key, settings[key])
    last_save_ok = file.save(settings_path) == OK
func _notification(what: int) -> void:
    if what == NOTIFICATION_APPLICATION_PAUSED:
        flush()
        if music != null:
            music.stream_paused = true
        if effects != null:
            effects.stream_paused = true
    elif what == NOTIFICATION_APPLICATION_RESUMED:
        if music != null:
            music.stream_paused = false
        if effects != null:
            effects.stream_paused = false
