> АКТУАЛЬНОЕ ПЕРЕОПРЕДЕЛЕНИЕ 24.09.2026: см. docs/production/POST_PAIRING_USB_2026-09-24.ru.md. Bluetooth сопряжён, но выбранный телефон теперь ADB unauthorized. PR17: 25/28 passed, переустановка/закрытие/запуск не завершены; merge и новый релиз не выполнялись. Подтверждение USB-отладки требуется на телефоне. После восстановления перейти в feature/tutorial-audio-20260924, свежая квалификация PR17, затем PR15. Старый снимок ниже сохраняется как история.

# Multimental — точка продолжения

Обновление наблюдений: 24.09.2026, 07:35 UTC. Не начинать настройку проекта заново.
Подробная квитанция: docs/production/RESUME_2026-09-24-0735.ru.md. Она уточняет прежний снимок, а не заменяет фактическую проверку.

## Разрешённая область
Только neurofoxpro/multimental; только VENEL-SENDRIK, Remote Desktop ID 418c9e1f-0c2b-4b28-95a3-722812a83408; Git/gh venelsendrik. Другие компьютеры/репозитории не использовать. Main/stable/Google Play требуют отдельного разрешения. Ничего не переносить в 4erk/multimental и не переустанавливать GitHub Connector/Make/runner.
Рабочая папка: %USERPROFILE%/MultimentalWork/repo. Bluetooth-ветка: соседний repo-beta. Это два worktree одного проекта.

## Фактическое состояние
Последний опубликованный dev-релиз — 0.2.0-alpha.65.1, LAN уже реализован и проверен. Повторять LAN с нуля не нужно.
На телефоне установлен и запущен более новый кандидат 0.2.1-alpha.73.1 из PR17, CI 35968212609. Он НЕ опубликован как dev-релиз.
PR17: feature/tutorial-audio-20260924, HEAD 704551b19ea894800378e660a825248c8f5900af. Обучение/звук, 27/28 сценариев; failed phone-bluetooth (10051). Повтор 07:32 UTC дал ту же ошибку, Wi-Fi восстановлен. PR draft.
PR15: feature/bluetooth-pvp-20260924, HEAD f0d356af0ffb84472bb51db3909c6a07827df0b4, в repo-beta. Secure Bluetooth ждёт системного pairing: radioPresent=true, authenticated=false. PR draft. Старый insecure diagnostic не подтверждает готовность secure PvP.

## Следующий шаг
Сначала list_devices и текущие hostname/origin, затем scripts/chat.cmd resume и device-status. Восстановить нужную ветку без reset/clean, не менять дерево при живом lock.
Не запускать новый полный радиопрогон до проверки prerequisites. В repo-beta: scripts/chat.cmd bluetooth-pairing. При authenticated=false требуется подтверждение совпадающего кода на телефоне и Windows владельцем.
После pairing отдельно повторить диагностический Bluetooth-тест PR17: ошибка 10051 не доказана исключительно следствием pairing. Затем новая полная квалификация текущего APK. Не маскировать failed как passed, не убирать защиту secure-соединения.
После успешных checks и полной квалификации — интеграция только в dev, автоматический dev-релиз и доставка с проверкой версии/хеша. Не делать downgrade кандидата на физическом телефоне; данные не очищать.

## Обязательный readset
AGENTS.md; docs/production/AUTHORITY.md; skills/game-production/SKILL.md; .gameprod/project.json, decisions.json, requirements.json, state.json, backlog.json, roadmap.json, research.json; docs/MANUAL_TESTS.ru.md; CHANGELOG.ru.md; актуальные квитанции и PR.
Исторические state/backlog могут отставать: timestamped evidence и live Git/устройство важнее старого planned/implemented. Все решения концепта сохраняются в decisions/requirements и CHAT_RECOVERY.ru.md.

## Незавершённое
Коллекция/колоды, магазин/паки/крафт, награды/задания/уровни и транзакционные сохранения — ещё программная работа. Не перекладывать её в ручную приёмку. Особая система взаимодействий стихий отложена владельцем. Beta не готова.
Ручное: системный Bluetooth pairing, оценка интереса/читаемости/звука и отдельное решение main/stable. Git/gh/ADB/подпись/обновлятор уже настроены. Секреты и идентификаторы устройств не публиковать.
