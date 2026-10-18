# AUTO-08 — Проверяемый офлайн-инструментарий

Команды:

- `node tools/offline-toolchain.mjs policy` — чисто исходниковый контроль на CI/Linux/Windows.
- `node tools/offline-toolchain.mjs check` — только VENEL-SENDRIK: сверка локальных архивов, Node/npm/Godot, package-lock и лицензий.
- `node tools/offline-toolchain.mjs verify` — предыдущие проверки, затем чистое `npm ci --offline` во временном каталоге и полный `tools/verify.mjs`.

Контроль не скачивает файлы и не изменяет сетевые настройки, VPN, профили, ключи, устройство или привязанные существующие каталоги. Архивы проверяются поточным SHA-256, четыре файла закреплены по реальным локальным bytes. Конфигурация отражает различие station Node 24.21.0 и CI Node 22; Godot 4.7.2 и Android Build Tools 35.0.1 не обновляются. npm-lock учитывает все зависимости и лицензии.

`npm ci --offline` гарантирует, что npm использует только локальный cache. Для дочернего verify выставлены offline-флаг npm и нерабочие адреса HTTP(S)-прокси. Это не низкоуровневая блокировка всех сокетов Godot/Node: такой эксперимент требует отдельной явно согласованной изоляции, поэтому по одному этому признаку нельзя утверждать, что Windows физически была без сети.

Источники: `.gameprod/toolchain.json`, `scripts/bootstrap-station.ps1`, `scripts/setup-godot.sh`, `.nvmrc`, `package-lock.json`, `.github/workflows/build.yml`. Изменение версий/хешей допускается отдельным проанализированным PR; миграции Godot во время BALANCE-01 нет.
