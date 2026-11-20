# JNI-ответы закрепления ярлыка: наблюдаемый дефект и исправление

## Что воспроизведено

На реальном Android-эмуляторе Multimental_Test_B, APK 0.13.3-alpha.259.1, восемь шагов handoff прошли, но native ensure не смог закрепить значок. Logcat показал: Invalid operands 'int' and 'bool' in operator '!=' в _request_pin. Из Android-wrapper вернулся целочисленный boolean, а код сравнивал Variant с true. Итог not_confirmed был следствием ошибки исполнения, а не доказанным отказом launcher.

## Исправление границы типов

Model.native_flag принимает только TYPE_BOOL или TYPE_INT со значением 0/1. Строки, float, null и прочие truthy-значения отвергаются. Все три вызова — isRequestPinShortcutSupported, isEnabled и requestPinShortcut — проходят один адаптер. Неверный тип немедленно публикует конкретную ошибку, а не ждёт истечения времени. Уже зафиксированная Java-ошибка не перезаписывается последующими вызовами.

Это совместимость наблюдаемого интерфейса JNI, не утверждение, что все версии Godot возвращают boolean именно целым числом. Проверки JavaClassWrapper.get_exception после каждого вызова сохранены. Уже существующий pinned ID не создаётся повторно; requested не считается успешным добавлением на домашний экран.

## Воспроизводимые проверки

`scripts\chat.cmd profile-test launcher-bridge` выполняет 34 проверки: оба представления true/false, отклонение других типов, запрос ровно один раз, неподдерживаемый launcher, уже закреплённый ярлык и post-request polling. FakeNative не обращается к Android и не выдаётся за аппаратную проверку. Набор входит в полный verify. После выпуска требуется отдельный `lab test` на AVD и `lab test --target phone` с настоящим поиском домашнего значка.

Предыдущая неудачная операция сохраняется, не повторяется на том же APK вслепую. Новая версия должна иметь новую проверенную установку и собственную квитанцию.

## Первичные источники

- https://developer.android.com/develop/ui/compose/system/shortcuts/creating-shortcuts — запрос, поддержка launcher и подтверждение закрепления.
- https://docs.godotengine.org/en/stable/classes/class_javaclasswrapper.html — Android JNI-wrapper и проверка исключений.

Доказательства исходной ошибки и локальной регрессии: evidence/launcher-native-bridge-observed-20260926.json.

## Дополнительная защита входа

Mode, expectedVersion и nonce проверяются как строки до сравнений Variant. Отдельный launcher-request набор содержит 40 проверок, включая 24 подстановки неверного типа. Неверный приватный запрос не должен приводить к ошибке исполнения или Android-вызову.

Первый PR-кандидат был отвергнут CI из-за отсутствия нового русского changelog fragment. Локальная проверка текста changelog и покрытие изменений в CI — разные проверки. Ошибка исправлена новой записью; результат старого CI не подменяется. В последовательностях команд проверять LASTEXITCODE после каждого .cmd, а не полагаться только на PowerShell ErrorActionPreference.

## Второй фактический Android-дефект

После исправления bool версия 0.13.4-alpha.263.1 прошла восемь handoff-этапов, но упала на ApplicationInfo.icon: JavaObject не предоставил его как GDScript property. Настоящий logcat сохранён отдельно. Исправление использует только Android-методы: getComponentName → PackageManager.getActivityInfo → ComponentInfo.getIconResource. ID проверяется как положительный int. Тестовая заглушка больше не возвращает удобный Dictionary с icon, который маскировал несовпадение настоящего интерфейса.

Первичный API-контракт: https://developer.android.com/reference/android/content/pm/ComponentInfo#getIconResource() . Возвращается иконка компонента, а при её отсутствии — приложения. Повторное Android-испытание нового APK обязательно; новый код сам по себе не подтверждает создание значка.

## Конструктор вложенного Java-класса

Версия 0.13.5-alpha.266.1 подтвердила исправление icon, затем фактический JavaClass отказал в Builder: Method not found. Перед вызовом теперь используется документированный JavaClass.has_java_method для закрытого набора имён конструктора. Выполняется ровно один найденный метод, отсутствие/неоднозначность блокирует запрос; никаких пробных вызовов конструкторов или исполнения произвольных имён из данных. Использованное имя записывается в результат для точного Android readback.

Первичный контракт: https://docs.godotengine.org/en/stable/classes/class_javaclass.html . Десктопная заглушка знает доступные имена явно, а не имитирует успех любого конструктора.

## Проверка точного кода установленного движка

На 0.13.6-alpha.269.1 не было runtime exception, но проверка нескольких имён дала false ambiguity. Причина установлена по исходникам именно Godot 4.7.2-stable, platform/android/java_class_wrapper.cpp: JavaClass.callp и has_java_method заменяют java_constructor_name на `<init>`. Значит `<init>` и ShortcutInfo$Builder могут означать один метод. Теперь проверяется только канонический `<init>` и вызывается ровно один раз. Проверки специально содержат оба alias одновременно и не считают их конфликтом.

Источник: https://github.com/godotengine/godot/blob/4.7.2-stable/platform/android/java_class_wrapper.cpp ; blob f1a9b689dfa9381b941b90b9f6ebd12b5b755a27, методы callp/has_java_method. Вывод из более новой ветки или предположение по имени Java-класса не заменяют этот контракт версии.
