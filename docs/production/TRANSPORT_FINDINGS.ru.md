# Исправления, найденные автоматическими и аппаратными проверками

## JSON-протокол
Числа после JSON.parse_string в Godot не обязаны иметь тот же Variant-тип, что int исходного ядра. На реальном канале команда отклонялась при сравнении словарей. На границе протокола теперь явно валидируются целые v/seq/hand/cell/source/target, нормализуются типы и отвергаются дроби/неизвестные поля. Добавлены тесты реального JSON roundtrip, не только вызова словарём в памяти.

## Android JNI и Bluetooth
RFCOMM-соединение работало, но однопараметрический write не завершал ответ через обёртку Java. Диагностика отдельного рабочего потока зафиксировала фазу before_write. Транспорт использует явный OutputStreamWriter.write(String, offset, UTF16Length), после чего flush. Тот же путь с русским текстом и дополнительным Unicode проверяется в Android-эмуляторе без радиоустройств.

На кандидате alpha.43.1 реальный Bluetooth-обмен прошёл шесть сообщений с выключенным Wi-Fi. Это лабораторный nonce-ограниченный RFCOMM-сеанс, а не обещание готового пользовательского Bluetooth-лобби или production-сопряжения. USB служит только управлению тестом; полезная нагрузка Bluetooth проходит через Windows AF_BTH и адаптер.

## Эмуляторная подсказка поверх UI
Скриншот показал системную подсказку Viewing full screen, закрывавшую верхнюю клетку. Карта в нижней части нажималась, но событие до клетки не доходило. В выделенных AVD перед запуском применяется такая же подготовка, как в AOSP CTS: settings put secure immersive_mode_confirmations confirmed и возврат Home. Настройки реального телефона этим шагом не меняются. Реальные Android input tap остаются обязательными: прямой вызов игрового обработчика не выдаётся за OS-касание.

## Первоисточники
- Android CTS fixture: https://android.googlesource.com/platform/cts.git/+/75411edca5a6f2f2542fd7f784163d03047d80ac/tests/tests/view/AndroidTest.xml
- Android fullscreen confirmation: https://android.googlesource.com/platform/frameworks/base.git/+/4df38aa2bad694545374e839713083031ba3a681
- Godot JavaClassWrapper: https://docs.godotengine.org/en/stable/classes/class_javaclasswrapper.html
- Android streams: https://developer.android.com/reference/java/io/OutputStreamWriter
- Godot input transforms: https://docs.godotengine.org/en/latest/tutorials/2d/2d_transforms.html
- GitHub artifact download: https://docs.github.com/en/rest/actions/artifacts#download-an-artifact

Ссылки поясняют использование API; фактические результаты подтверждаются отдельными квитанциями проекта. Один успешный тест транспорта не считается всей готовой сетевой игрой.
