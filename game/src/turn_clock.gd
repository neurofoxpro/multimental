extends RefCounted
## One shared, deterministic turn allowance for local AI and authoritative LAN play.
## MatchCore turn 1/2: both players' first personal turn; 3/4: second turn.
const BASE_MS: int = 90000
const TEST_BONUS_MS: int = 5000

static func millis_for_turn(turn: int) -> int:
    return BASE_MS + TEST_BONUS_MS * maxi(0, int((turn - 1) / 2))

static func seconds_for_turn(turn: int) -> int:
    return int(millis_for_turn(turn) / 1000)

static func text_for_seconds(seconds: int) -> String:
    var safe: int = maxi(0, seconds)
    return "%d:%02d" % [int(safe / 60), safe % 60]
