# Производство игр: рабочий скилл v2

Основная инструкция: [SKILL.md](SKILL.md). Профиль, решения и задачи: [../../.gameprod](../../.gameprod). [Проверенный результат](../../docs/production/OPS_V2_RESULTS.ru.md), [roadmap](../../docs/ROADMAP.ru.md).

## Для текущего проекта
В Git checkout Multimental на VENEL-SENDRIK:

```powershell
.\scripts\chat.ps1 resume
.\scripts\chat.ps1 begin feature/next-change
# Агент делает содержательное изменение игры.
.\scripts\chat.ps1 cycle "feat: description" "Название изменения"
```

--physical добавляет реальный телефон, LAN и Bluetooth. По умолчанию тесты без аппаратных требований выполняются в двух выделенных Android-эмуляторах; затем dev-релиз устанавливается на телефон. Ключ подписи и настройки сохраняются. Очистка данных разрешена только тестовым AVD.

cycle включает verify → commit/PR → CI → проверенный APK → qualification → merge dev → CI/release → exact-commit delivery → report. Main/stable не объединяются автоматически.

Для диагностики: prepare, candidate, qualify, device-test, probe-bluetooth, logs. После остановки доставки уже объединённого коммита — resume-cycle. Самостоятельное ожидание не выдаётся за выполненную работу. Для сохранения результатов — report --write, затем отдельный docs-only PR.

## Для другого проекта
Скопировать каталог game-production в существующий Git-репозиторий и запустить init.mjs с явными root, repository, host и name. Новый remote не создаётся, существующий профиль не перезаписывается. Настроить реальные команды теста/сборки и адаптер платформы: пустые gates не проходят.

Универсальное ядро — правила этапов, конфигурация, проверки контекста/квитанций, блокировки и оркестрация. Android/Godot-адаптеры Multimental находятся в scripts и tools корня проекта; они не становятся автоматически пригодными для другого движка без адаптации. Продуктовые решения и ручная приёмка остаются явными отдельными этапами.
