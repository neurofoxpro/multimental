# AUTO-07: восстановление прерванных production-операций

Цель - после падения процесса или потерянного ответа не угадывать, был ли выполнен commit, upload, merge, sign или install, и не оставлять production-цепочку навсегда заблокированной осиротевшим lock-файлом.

## Общий контракт

- Неоднозначный результат записи не разрешает повторять её вслепую. Сначала читается фактический эффект.
- Task/source/claim/branch/target и хеши входов проверяются до продолжения. Изменившийся контекст блокирует resume.
- Lock восстанавливается только при доказанно отсутствующем PID (`ESRCH`). `EPERM`, ошибка probe, неправильный PID, неизвестная команда, свежий или повреждённый lock означают preserve/block.
- Recovery не принимает задачу, не меняет source/claim/PR, не доказывает human/device acceptance и не даёт права на main/stable/Play.

## Commit

`ops publish` использует локальный journal до commit: branch, source fingerprint, прежний HEAD, точное staged tree и сообщение commit.

- До эффекта: тот же base HEAD и точное staged tree разрешают один commit.
- Потерянный ответ после commit: новый HEAD переиспользуется только если он единственный прямой потомок прежнего HEAD, имеет точное дерево и точный subject; второй commit не выполняется.
- Чужой descendant, другой source fingerprint, branch, message или dirty post-commit блокируют публикацию.
- Journal удаляется только после подтверждённого readback публикации exact HEAD.

## Upload и merge

Существующие политики сохраняются: release asset сначала сверяется по имени/размеру/SHA-256, а merge после неопределённого ответа перечитывает exact PR/head/base/merge commit. Потерянный ответ не превращается во вторую запись.

## Sign

Manual APK создаётся через отдельный `.staging.apk` и `ensureSignedCandidate`.

- Нет final/staging: sign выполняется один раз в staging.
- Staging уже есть: сначала проверяются постоянный dev-certificate и payload; sign не повторяется.
- Проверенный staging продвигается через copy-with-EXCL.
- Проверенный final переиспользуется после lost promotion acknowledgement.
- Любой существующий повреждённый/чужой staging или final блокирует продолжение и сохраняется для разбора; валидный final не скрывает чужой staging.

## Install

Существующий `confirmInstallEffect` после install перечитывает фактические versionCode/SHA-256. Точная уже установленная версия после потерянного ответа не устанавливается второй раз; неизвестные same-version bytes, другая подпись и downgrade блокируются.

## Осиротевшие source/production locks

`source-recover plan` только наблюдает. `source-recover apply` требует авторизованную VENEL-SENDRIK, canonical origin, зарегистрированный feature/fix/docs/test worktree и live coordinator ownership оператора.

Восстанавливаются только явно перечисленные lock path + command. Перед первым rename читается весь целевой набор. Любой recognized live/unknown/fresh/malformed lock блокирует всю операцию. Для stale lock фиксируются исходные bytes SHA-256, inode/device, PID/token/startedAt/command; перед rename всё читается повторно. Исходные bytes архивируются без повторной сериализации. На освобождённые пути временно ставятся recovery barriers. Если конкурент успел занять путь после rename, его новый lock сохраняется и recovery завершается incomplete.

Собственный `source-recovery.lock` и temporary recovery barriers также самовосстанавливаются только при exact command и доказанно отсутствующем владельце, чтобы recovery не создавал новый вечный blocker.

Device installation/update/test locks остаются отдельной областью `device-recover`; source recovery их не снимает.

## После recovery

Recovery только освобождает доказанно осиротевшую операционную блокировку. Затем запускается обычная исходная команда (`ship`, `review resume`, `lab resume`, `accept` и т.п.), которая заново проверяет checkpoint, source, task, claim, release/target и собственные критерии.
