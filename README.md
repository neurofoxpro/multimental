# Multimental

Release-first 3x3 collectible elemental card duel. Canonical repository: `neurofoxpro/multimental`.

## Start here
- [Production skill](skills/game-production/SKILL.md)
- [Recovered decisions and scope](docs/production/CHAT_RECOVERY.ru.md)
- [Authority](docs/production/AUTHORITY.md)
- [Device updater](docs/production/DEVICE.md)
- [Signing boundary](docs/production/SIGNING.md)
- [.gameprod](.gameprod): machine-readable decisions, lifecycle, backlog and observed state.

## Commands
```
npm run production -- status
npm run verify
npm run build:android
npm run build:web
npm run device:update -- --config LOCAL_CONFIG
```

Feature/PR: hosted checks and artifact. Passing dev push: development prerelease. Reviewed updater on VENEL-SENDRIK: check canonical provenance and hashes, sign with persistent private local development identity, update paired Android phone in place, record installation. No other computer is authorized. No automatic main merge or stable release.

The first playable alpha has provisional cost/attack/health rules, one action per turn, 3x3 placement, adjacent combat, deterministic simple AI, RU/EN and finite matches. Catalogue/economy/network and the owner's deferred central card mechanics remain in the backlog. A build is not a device test; see receipts and the session report for actual outcomes.
