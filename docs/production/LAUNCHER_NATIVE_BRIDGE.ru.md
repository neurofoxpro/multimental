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
