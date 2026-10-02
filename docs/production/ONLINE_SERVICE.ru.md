# NET-06 — авторитетная online-служба

Первый инкремент добавляет отдельную многокомнатную online-границу поверх уже принятого `RoomRules -> MatchCore`. Правила боя не переписаны в серверном коде.

## Слои

- `online_protocol.gd` — публичный versioned JSON envelope: service protocol v1 + exact `RoomRules.RULES`.
- `online_service.gd` — room registry, membership, identity/token reconnect, rate/room/TTL limits и маршрутизация команд в существующий `RoomRules`.
- `online_wss.gd` — bounded reliable WSS packet transport. Plain `ws://` этим адаптером не допускается.
- `online_server.gd` — headless-friendly Node adapter, который связывает WSS packets с `OnlineService` и публикует обновлённый player-relative state участникам.

Godot 4.7 имеет встроенный `WebSocketMultiplayerPeer.create_server(..., TLSOptions.server(...))`, поэтому дополнительный PHP/Swoole combat server не нужен.

## Авторитетность

Каждая room хранит ровно один `RoomRules`, а тот — один `MatchCore`. Online-слой не считает урон, направления, стоимость, победу, таймеры боя или legal actions.

Команды клиента проходят:
`WSS -> bounded JSON -> OnlineProtocol -> OnlineService -> RoomRules.act() -> MatchCore.apply()`.

Повтор команды с тем же sequence получает сохранённую квитанцию `RoomRules`; conflicting repeat и out-of-order отклоняются существующим ядром.

## Текущие инженерные лимиты

Значения являются защитными defaults реализации, а не монетизационной/продуктовой политикой:

- до 64 одновременно зарегистрированных rooms на process;
- waiting room TTL 5 минут;
- finished room retention 1 минута;
- до 80 service requests на peer за 10 секунд;
- WSS JSON packet до 32 KiB;
- WSS queue до 64 packets; за один poll обрабатывается не более 16;
- 2 игровых участника на room — существующая модель RoomRules.

Все лимиты, кроме packet framing, могут быть уменьшены/настроены при создании service для конкретного хоста.

## Проверки первого инкремента

`online_service_test.gd`:
- независимость нескольких rooms;
- exact service/rules versions;
- capability не попадает в player view;
- wrong token/foreign identity fail closed;
- join/reconnect/host reattach;
- authoritative command и duplicate idempotency;
- room/rate/waiting TTL limits;
- bounded packet decode.

`online_wss_test.gd` поднимает loopback WSS на реальном Godot WebSocketMultiplayerPeer с временным test certificate, согласует subprotocol `multimental.v1`, создаёт room, подключает второго клиента и проверяет state push/ping.

Существующие `room_test.gd` и `lan_test.gd` продолжают проверять то же authoritative core, TLS LAN и reconnect.

## Что ещё не закрыто

NET-06 после этого инкремента остаётся открытой:

1. Нужен runnable deployment entrypoint/config для headless service: bind/port и внешние TLS cert/key без хранения секретов в репозитории.
2. Guest disconnect уже имеет 60-секундную grace внутри RoomRules. Host identity может reattach, но его turn timer пока не получает симметричную 60-секундную pause/grace. До приёмки это надо решить в authority/session contract, не маскировать transport-слоем.
3. Нужны failure tests для server restart/room loss и явная политика отсутствия persistence либо восстановление.
4. Нужен реально доступный бесплатный или предоставленный владельцем hosting target. Его sleep/quota/availability должны быть измерены, а не обещаны по описанию тарифа.
5. Public hostname/TLS certificate и фактический внешний `wss://` smoke-test выполняются только после появления такого хоста.

До этих шагов loopback WSS доказывает код транспортной границы, но не публичную доступность сервиса.
