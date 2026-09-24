---
name: game-production
description: Evidence-gated release-first production for a game: recover decisions, validate, test, build, publish prerelease and install exact Android artifacts. Universal Node scripts with project-specific engine adapters.
---

# Game Production v2

## Working tools first
Use scripts/chat.ps1 resume, verify, cycle, device-test, network and emulator instead of repeating Git/gh/ADB command sequences. See docs/production/OPS_V2.ru.md and docs/ROADMAP.ru.md. The Git worktree and portable tools are reused.

## Start / recovery
Read AGENTS.md, docs/production/AUTHORITY.md and all .gameprod JSON files. Run `node skills/game-production/scripts/gameprod.mjs status` and `validate`. Inspect canonical Git branches, PRs, Actions and releases at exact SHAs. Continue from the first unmet gate, not from old assistant promises. Source decisions and observed implementation are separate.

## Authorization
An explicit repository and execution host are required. Verify Remote Desktop device ID against its advertised name, then verify the OS hostname. The host scripts reject a different host or Git origin. A source snapshot must include canonical repository and commit metadata. Active station account is venelsendrik with existing MAINTAIN access; no new tokens or Chrome sign-in are needed. No fallback repository, computer, credential escalation, repository creation, transfer, force-push or destructive cleanup. Do not modify other workspaces. Existing directories are preserved.

## Production loop
Small approved increment -> code/data -> metadata validation -> tests -> build -> manifest/hash -> device preflight -> install -> launch check -> evidence report -> manual play acceptance. Keep release-first: advanced art, economy, new mechanics and network can be deferred without pretending they are finished.

`gameprod.mjs run STEP` executes configured argument arrays, shell disabled, bounded timeout, explicit dependencies. Each run writes a source-bound receipt and hashed log. `gate GATE` rejects absent, failed, stale or altered receipts. No empty gate succeeds. The tool does not accept an agent-edited boolean as stable-release approval.

## Coverage
`.gameprod/lifecycle.json` covers every development phase from governance/concept to support. `.gameprod/decisions.json` distinguishes accepted, recommended, deferred and superseded choices. `.gameprod/backlog.json` lists executable targets and remaining work. Do not ask already answered questions. Apply delegated recommendations only where they do not silently alter the accepted game.

## Core and content
Keep rules independent of Godot scenes, frames, animation and transport. Use versioned deterministic commands, ordered effects and a recorded seed. Private deck order and seed are not public client synchronization data. Future networks send player-filtered state; a full-state hash does not prove host honesty. Cards are data, effect implementations are reviewed code. Match log, economy ledger and technical diagnostics remain separate.

## Device/update safety
The local updater is a reviewed installed script, not a generic public-repository self-hosted runner. It downloads APK/data only and never executes downloaded scripts. Require exact canonical release, manifest, APK hash, package allowlist and one selected authorized phone. Never uninstall or clear real-phone data, and never downgrade automatically. The current owner explicitly authorizes automatically closing the development game for update/tests. Respect the station autoCloseForUpdate setting; data is preserved. Clean installs are restricted to the dedicated emulator. Repeated successful artifact installs are idempotent; failures remain retryable. Use a lock to avoid concurrent installs.

The .dev APK is explicitly test-only. Permissions are reviewed and allowlisted; Bluetooth diagnostics require the Android Bluetooth connection permission. Current signing uses a persistent PRIVATE LOCAL development key; no public private key is used or published. Production identity/signing remain separate, and both original and locally re-signed APK hashes are recorded.

ADB permission, connecting/unlocking a phone and subjective play acceptance are human boundaries. Report `blocked`, not success, when any of those is unavailable. Device serials and application logs stay local; only a redacted receipt may enter Git.

## Commands
```
node skills/game-production/scripts/gameprod.mjs status
node skills/game-production/scripts/gameprod.mjs validate
node skills/game-production/scripts/gameprod.mjs run verify
node skills/game-production/scripts/gameprod.mjs gate verified
node skills/game-production/scripts/gameprod.mjs run build:android
node scripts/update-device.mjs --config PATH
```

For another game, copy the skill and run `scripts/init.mjs --root EXISTING_GIT_REPO --repository owner/repo --host HOST --name NAME`. It does not create remote repositories, overwrite profiles or invent test/build commands. Configure adapters before gates can pass.

## Finish
Record changed files and Git commit/PR, executed tests, source/artifact identity, actual install outcome, pending manual acceptance and next task. A script can formalize deterministic work, but it cannot automatically invent and approve all future design or replace human acceptance. Claim ongoing automation only after an actual scheduler/workflow is installed and verified.

## Complete working loop (v2)
Use scripts/chat.ps1 cycle "message" "title" --physical for changes that touch device transports. The default cycle qualifies two dedicated Android emulators before dev integration. The physical option adds actual phone UI, persistent reinstall, USB tunnel, LAN, emulator-to-phone LAN and real RFCOMM with Wi-Fi disabled/restored. A passing JNI memory-stream test is required in each emulator before the radio test.

Commands prepare and probe-bluetooth narrow debugging without publishing a release. resume-cycle continues a matching post-merge delivery if interruption occurred. Operation leases reject overlapping writers; do not delete live lockfiles. Every qualification is bound to exact candidate SHA, APK hash and source fingerprint; zero errors is not inferred from an incomplete list.

Device UI tests use actual Android input taps, not direct method calls. Dedicated emulator setup handles the Android full-screen tutorial; unexpected system dialogs are not blindly accepted. Real user gameplay acceptance remains separate.

Report: scripts/chat.ps1 report --write writes sanitized observation files/state. Commit those in a documentation-only PR so recording work does not create another APK. No raw device IDs, addresses, nonce files, keys or app logs enter the public report.

## Latest verified completion
See docs/production/OPS_V2_RESULTS.ru.md and docs/production/evidence/production-v2-cycle.json. The full v2 cycle completed through PR11, 37 Node tests, 23 device scenarios and actual installed dev release. Roadmap 0.2.0 is player-facing LAN, not a repeat of station setup.

Release delivery is bound to the exact expected merge commit. A stale release listing or deferred installation is waited for within a bound; neither exit 0 nor a receipt for another version can finish the delivery gate. Preserve prior engineering receipts before a documentation-only cycle replaces local latest-state files.
