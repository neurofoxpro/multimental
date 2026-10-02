extends VBoxContainer
## Offline optional quests; the profile controller is the only writer.
signal leave_requested
const Policy = preload("res://src/rewards_policy.gd")
const Rules = preload("res://src/rewards_rules.gd")
var host: Control
var summary: Label
var status: Label
var buttons: Dictionary = {}
var request: Dictionary = {}
var observed_day: int = -1
var busy: bool = false

func setup(owner_ui: Control) -> void:
    host = owner_ui
    name = "RewardsScreen"
    add_theme_constant_override("separation", 14)
    preload("res://src/scrollable_page.gd").wrap(self)
    add_child(host.label(host.t("НАГРАДЫ И ЗАДАНИЯ", "REWARDS AND QUESTS"), 28))
    summary = host.label("", 22)
    summary.name = "RewardsSummary"
    add_child(summary)
    add_child(host.label(host.t("За завершённую партию: 20 монет и 10 опыта; за победу ещё 10 монет и 5 опыта. Поражение ничего не отнимает. Обучение и диагностика наград не дают.", "Completed match: 20 coins and 10 XP; victory adds 10 coins and 5 XP. Defeat removes nothing. Tutorial and diagnostic matches give no rewards."), 18))
    add_child(host.label(host.t("Добровольные задания обновляются в 00:00 UTC по часам устройства. Нет серии посещений и штрафа за пропуск. Перевод часов назад не открывает старые задания заново.", "Optional quests refresh at 00:00 UTC using the device clock. No login streak or missed-day penalty. Moving the clock back does not reopen old quests."), 18))
    for id in Policy.QUESTS:
        var action: Button = host.button("", claim.bind(id), 72)
        action.name = "Claim_" + id
        buttons[id] = action
        add_child(action)
    status = host.label("", 18)
    status.name = "RewardsStatus"
    add_child(status)
    add_child(host.label(host.t("Локальная тестовая прогрессия, не рейтинг и не серверная валюта. Каждые 100 опыта — новый уровень без усиления карт. Все 30×2 карты альфы остаются доступны без гринда.", "Local test progression, not rating or server currency. Every 100 XP gives a level without card stat bonuses. All 30×2 alpha cards remain available without grinding."), 18))
    var back: Button = host.button(host.t("В МЕНЮ", "MENU"), leave, 62)
    back.name = "RewardsBack"
    add_child(back)
    host.call_deferred("_focus_control", weakref(back))
    sync_day()
    refresh()

func sync_day() -> bool:
    observed_day = host.rewards_day()
    if not host.profile.flush():
        status.text = host.profile.error
        return false
    var state: Dictionary = host.profile.state()
    if (not state.has("rewards") or observed_day > int(state.rewards.day)) and not host.profile.commit({"kind": "rewards_day", "day": observed_day}):
        status.text = host.profile.error
        return false
    return true

func _process(_delta: float) -> void:
    if is_instance_valid(host) and not busy and request.is_empty() and observed_day != host.rewards_day():
        sync_day()
        refresh()

func refresh() -> void:
    var state: Dictionary = host.profile.state()
    var progress: Dictionary = state.get("rewards", Rules.fresh())
    summary.text = host.t("Уровень %d · Опыт %d/%d\nМонеты: %d · Сегодня партий: %d/3", "Level %d · XP %d/%d\nCoins: %d · Matches today: %d/3") % [Policy.level(int(progress.xp)), int(progress.xp) % Policy.LEVEL_XP, Policy.LEVEL_XP, int(state.get("wallet", {}).get("gold", 0)), int(progress.played)]
    if observed_day < int(progress.day):
        summary.text += host.t("\nЧасы переведены назад: используется последний сохранённый день.", "\nClock moved back: using the last saved day.")
    for id in buttons:
        var q: Dictionary = Policy.QUESTS[id]
        var done: bool = id in progress.claimed
        var pending: bool = not request.is_empty() and request.get("quest") == id
        buttons[id].text = host.t("Сыграть %d · %d монет + %d опыта", "Play %d · %d coins + %d XP") % [q.matches, q.gold, q.xp]
        buttons[id].text += host.t(" · ПОЛУЧЕНО", " · CLAIMED") if done and not pending else (host.t(" · ПОВТОРИТЬ СОХРАНЕНИЕ", " · RETRY SAVE") if pending else " · %d/%d" % [mini(int(progress.played), int(q.matches)), q.matches])
        buttons[id].disabled = busy or not host.profile.enabled or (not pending and (done or int(progress.played) < int(q.matches) or not request.is_empty() or not host.profile.error.is_empty()))

func claim(id: String) -> void:
    if busy or not host.profile.enabled or not Policy.QUESTS.has(id):
        return
    if request.is_empty():
        if not sync_day():
            refresh()
            return
        var progress: Dictionary = host.profile.state().rewards
        if id in progress.claimed or int(progress.played) < int(Policy.QUESTS[id].matches):
            refresh()
            return
        request = {"kind": "reward_claim", "day": int(progress.day), "quest": id}
    elif request.quest != id:
        return
    busy = true
    var saved: bool = host.profile.commit(request)
    busy = false
    if saved:
        request.clear()
        status.text = host.t("Награда сохранена", "Reward saved")
        sync_day()
    else:
        status.text = host.t("Сохранение не подтверждено: ", "Save unconfirmed: ") + host.profile.error
    refresh()

func leave() -> void:
    if not host.profile.flush():
        status.text = host.profile.error
        refresh()
        return
    request.clear()
    leave_requested.emit()
