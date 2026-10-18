# AUTO-08 — Единая версия Android и шаблоны экспорта

CI использует `node tools/android-version-code.mjs GITHUB_RUN_NUMBER GITHUB_RUN_ATTEMPT`, формула `10000 + runNumber × 100 + attempt`.

Допустимы положительный run number, attempt от 1 до 99; результат не больше 2100000000. Обратный переход или одинаковый Android versionCode для другого run/attempt блокируется. `tools/stamp-build.mjs` проверяет вычисленную версию, а отсутствие/дублирование полей `version/code`, `version/name` и `config/version` останавливает stamping **до любых записей**.

Source-level тест сверяет CI Godot 4.7.2, Android Build Tools 35.0.1, закреплённые 64-hex checksum binary/templates в `scripts/setup-godot.sh`, выбранную Android dev package и arm64-v8a. Это не заменяет фактическую сборку CI, которая проверяет извлечённые templates.

Профиль/каталог карт/правила/keystore/установленные APK не меняются. Успешные CI+dev выпуска подтверждают сборочную цепочку, но не реальный запуск новой APK на Redmi.
