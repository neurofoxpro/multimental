# Восстановление просроченного zero-work claim

Этот маршрут нужен только когда claim истёк, но работа по нему фактически не началась. Он не заменяет обычный release, completed recovery или interrupted continuation.

Команды:
- scripts/chat.cmd collab recover-zero-work TASK
- scripts/chat.cmd collab recover-zero-work TASK --apply

Первая команда только строит свежий proof. Вторая разрешена только из собственного активного среза с area:automation, area:coordination или area:workspaces, причём реализация recovery уже должна входить в dev и иметь source-bound verification.

## Что должно быть доказано

- exact target token/fence/binding и истёкший heartbeat;
- один зарегистрированный чужой worktree;
- canonical repository и разрешённая feature/fix/docs/test branch;
- worktree полностью clean, включая untracked files;
- claim base совпадает с local HEAD;
- base входит в наблюдённый dev;
- remote branch либо отсутствует, либо указывает ровно на тот же HEAD;
- между base и HEAD нет ни одного commit;
- для head branch нет PR ни в одном состоянии;
- нет активных Actions;
- нет live/unknown source, integration, worktree или qualification locks;
- live task Issue остаётся open и не имеет status=verified.

Один только TTL никогда не является достаточным доказательством.

## Apply

Перед CAS весь proof читается повторно под leases. Любое продление heartbeat, изменение claim/source/binding, появление PR, Action или lock прекращает операцию.

Удаляется только exact zero-work claim. Исходники, branch, worktree, task status, телефонные настройки и данные не меняются. Старый binding остаётся историческим файлом, но перестаёт давать права записи, потому что ownership каждый раз проверяется по live coordination-state.

Результат имеет sourceWrites=0 и phoneChanges=0. Task не принимается автоматически и новый claim не создаётся.

Потерянный ответ CAS сначала сверяется по operation ID и hash в coordination event log. Повтор уже завершённой операции читает тот же event и не может освободить replacement claim.

## Границы

Если существует merged PR, использовать recover-completed. Если существует ровно один незавершённый open PR и нужно продолжить работу, использовать continue-interrupted. Если дерево dirty, HEAD ушёл от base, remote branch расходится, задача закрыта/verified или состояние неизвестно, zero-work recovery обязан остановиться.

Первый реальный мотивирующий случай: Issue #167, AUTO-08 и BALANCE-01 30.09.2026. Это исправление координации, а не разрешение объявить эти задачи выполненными.
