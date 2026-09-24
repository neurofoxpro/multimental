# Multimental

Дуэльная карточная игра: общее поле 3×3, пять стихий, офлайн и локальные матчи. **Рабочая ветка — dev**, Android первым.

## Продолжение через чат
Сначала прочитать **[NEXT_CHAT.ru.md](NEXT_CHAT.ru.md)** и **[актуальную точку продолжения](docs/production/CONTINUATION_2026-09-24.ru.md)**. Проверенный LAN-релиз: **0.2.0-alpha.65.1**, [квитанция](docs/production/evidence/lan-release-completed.json). Работа над Bluetooth-кандидатом ведётся отдельно в PR15; установленная версия всегда проверяется заново, а не выводится из текста README.

Единственный репозиторий: neurofoxpro/multimental. Исполнительный компьютер: VENEL-SENDRIK. Git/gh: venelsendrik. На станции есть основной worktree repo и изолированный следующий repo-beta в %USERPROFILE%/MultimentalWork. Не переключаться на другой компьютер/репозиторий, не удалять незакоммиченные изменения и не настраивать Git/ADB заново.

Основной инструмент — scripts/chat.cmd. Команды: resume, audit, stage, candidate, qualify, integrate, wait-dev, deploy-agent, research, readiness, handoff. Полный допустимый цикл — cycle; после прерывания уже объединённой версии используется точная проверка delivery/resume-cycle. Source/HEAD/APK/квитанции должны совпадать; отсутствие ошибки команды не означает фактическую установку.

## Документы
- [Скилл производства](skills/game-production/SKILL.md)
- [Восстановленные решения](docs/production/CHAT_RECOVERY.ru.md)
- [31 группа требований и источники](.gameprod/requirements.json)
- [Roadmap](docs/ROADMAP.ru.md)
- [Русский changelog](CHANGELOG.ru.md)
- [Ручная приёмка](docs/MANUAL_TESTS.ru.md)
- [Текущие задачи и наблюдения](.gameprod)

## Готовность
Офлайн-игра и пользовательская LAN-комната проверены и выпущены. Bluetooth-режим и остальные beta-требования принимаются только после собственных проверок. Коллекция/экономика не считаются реализованными из-за наличия roadmap. Приватная dev-подпись остаётся на станции; оригинальный CI APK и установленный файл имеют отдельные хеши. Main, stable и Google Play требуют отдельного согласования.
