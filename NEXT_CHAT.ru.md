# Multimental — текущая волна 26.09.2026

Сначала live Issue29 и задача, затем skill. Не восстанавливать процесс по старым сообщениям о .150/.153: прежняя доставка разблокирована, профиль/редактор/свои сетевые колоды, магазин и крафт уже развиваются дальше.

PR111: магазин, merge099d0f5b61546b97407090c7e6a6e7793f050b75, .178.1 реально проверена OS-tap/storage.
PR112: измеряемое UX-исследование,24комбинации, safe collab refresh, mergef22dd346c6187230e0f0f98dddfc5b4dbf9541ba.
PR113: menu reflow/focus, mergeca48222d2a4ac8c86e054862aa52883e7da017be, .184.1 аппаратный smoke/collection прошли.
PR114: крафт, mergeb43247d36786245093d592edb6ce1706d0e67634. Его ранний аппаратный .187.1 crafting-run failed из-за координат popup; результат не перекрашен.
PR115: исправлен target viewport и подтверждение, merge2858c6fe7eb178ca5a057cc1af721ab20e8c777d, **.190.1 установлена**, crafting5OS-tap/shop/profile прошли. См. docs/production/evidence/crafting-completed-20260926.json.

Текущий диагностический PR добавляет read-only fleet usb и сохраняет доказательства. Его head/merge/последнюю установку читать live, не выводить из этого файла. На05:51Z Windows видит ещё один AndroidCandidate USB-container, но ADB толькоодин authorized, безunauthorized. Это не доказанная готовность второго телефона и не основание ставить драйверы наугад. QA02 открыта.

Магазин#33, крафт#34, UXresearch#106 — закрыты. ПродолжатьMETA04/#35 (награды/задания/уровни), UX07/#107 (полировка), QA02/#105 (второйтелефон). Точные зависимости/приоритеты находятся в Issues и snapshot. Старые задачи не переоткрывать без регрессии.

Параллельные чаты: docs/production/PARALLEL_CONTINUATION.ru.md, `collab start TASK UNIQUE_ALIAS`, работать только в выданном каталоге. Проверятьclaim и продлевать; перед переходом новой задачи release. ЗакрытыйIssue не равен новомуRC. Main/stable/Play требуют отдельного одобрения.
