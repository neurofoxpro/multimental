NET-06: Host reconnect grace

The authoritative RoomRules instance now handles host transport loss and restores the active player's remaining turn budget on reconnect, using a 60-second deadline. The service checks the existing session token and exact identity before reattaching; source of truth stays in RoomRules. The 15-minute match deadline keeps running. A disconnected inactive participant does not freeze the active player's turn.

Tests check host disconnect, frozen remaining seconds, identity rejection, exact resume and expiry to opponent win. Simultaneous disconnect resolution and public network latency acceptance remain separate work; this change does not claim physical or external network validation.
