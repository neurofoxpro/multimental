---
name: game-production
description: Task-aware, evidence-gated game production from ideas and simulations to development releases, safe Android delivery and explicit Google Play prerequisites. One CLI over existing guarded adapters.
---

# Game Production v4 — one task-aware entry point

## Read the minimum authoritative context

Read `NEXT_CHAT.ru.md`, `AGENTS.md`, `docs/production/AUTHORITY.md` and `.gameprod/project.json`. Resolve timestamps against live repository, PR, CI and device state. Use `npm run game -- next`, then `npm run game -- task TASK-ID` for the exact readset and acceptance. Do not reread every historical log or invent commands. Full task source: `.gameprod/workplan.json`; accepted rules: `.gameprod/decisions.json`; command details: `docs/production/CONTROL.ru.md`.

Only repository: neurofoxpro/multimental. Only personal execution host: VENEL-SENDRIK; verify connected device ID and OS hostname. GitHub-hosted CI is allowed. Internal offline analysis does not count as a device test. Never choose another computer, mirror/transfer/create repositories, force-push, escalate credentials or overwrite unrelated work. Existing station account/tools and private dev signing are reused.

## One entry for agent and human

Use `npm run game -- COMMAND`. On authorized Windows, `scripts/chat.cmd COMMAND` calls the same controller. Existing ops commands remain compatible, not a second production system.

```text
npm run game -- next
npm run game -- task META-05
npm run game -- start META-05
npm run game -- check
npm run game -- ship META-05
npm run game -- resume-cycle
```

`next` selects dependency-ready work; `task` supplies sources, criteria and exact commands; `start` creates the scoped feature branch. Implement the accepted change before `check` and `ship`: the CLI does not autonomously write missing gameplay. `check` generates planning projections and delegates audit. `ship` delegates the existing qualified dev cycle; it cannot authorize main/stable/Play production.

After interruption inspect `resume` and its real state; use the indicated step or `resume-cycle` for a matching already-integrated cycle. Do not start a second publication/install because an old response was lost. Follow operation locks; do not delete a live lock.

## Ideas and experiments

`idea IDEA-001 "description"` captures a proposal as data, never a shell command and never automatic approval. Link it to a reviewed workplan task or explicit deferral/rejection with reason and evidence. Do not invent the owner's intentionally deferred special mechanic or reinterpret rating-without-loss.

`experiment TASK-ID` currently runs a bounded, seeded existing balance baseline. New experiment types need reviewed adapters, explicit budgets, controls and pass criteria. `research plan/check` and task readsets identify primary sources and limits. Simulations do not replace human gameplay or actual radio tests.

## Source preparation and proof

Each substantive code change adds a Russian change fragment using `changelog add`; versions come from package metadata. Preparation runs the locked formatter and renderers BEFORE source-bound verification. Verification is read-only and rejects stale projections, logs, hashes, missing required markers and empty tests.

The workplan is canonical. `render` regenerates requirements, backlog, roadmap JSON and the human roadmap; `render --check` is enforced by verification and CI. Archives and state.json remain history, not current percentage readiness. A historical verified status does not qualify a new RC.

The bootstrap CI reconciler is restricted to owner push on feature/production-control-20260925. It prepares without write credentials, validates bounded allowlisted files and source hashes, then writes only that feature ref without force/merge/release. External PRs cannot run its writer. Verify fresh PR checks after a bot commit; do not infer that GITHUB_TOKEN retriggered them.

Use the reviewed source-edit helper with old/new hashes and recovery journal. Windows in-place fallback must be identified honestly, not called atomic. Wrong root, symlink, changed inputs and another lease are errors.

## Core and privacy invariants

Preserve current D19–D21, not obsolete early prototypes: directed/rotated attacks, optional attack phase, first strike and surviving replies, 30 cards/10 elements, terrain and income rules. Rules are independent of scene/FPS/animation/transport. Seeded replay includes exact rule/content versions. Never send another player's hidden hand, deck order or full RNG state to a client; state hash does not prove host honesty.

Cards are validated data; effect implementations are reviewed code. Match journal, technical logs and economic transactions stay separate. Missing collection/shop/crafting/account/upload code is engineering work, never manual acceptance.

## Existing dev cycle and device safety

Use the existing ops-backed cycle: prepare → verify/review → feature PR → CI candidate → required qualification → dev integration → matching prerelease → bounded safe delivery → redacted report. The default candidate uses two dedicated Android emulators; hardware-sensitive paths require the configured physical checks. A JNI stream test does not substitute real Bluetooth. Real Android↔Android testing remains distinct from Windows↔Android.

The installed updater downloads APK/data, not remote scripts; it is not a generic public-repository personal runner. Exact canonical release, manifest, package, artifact hash and selected authorized phone are required. Never uninstall/clear real-phone data or downgrade automatically. Owner-authorized dev-app closing for update/tests respects the station setting. Clean resets belong only to dedicated emulators. Reinstallation of an already confirmed artifact is idempotent; failures remain retryable.

Keep the persistent PRIVATE local dev key. Original release APK and locally re-signed installed APK have separate hashes; production identity is separate. Do not publish keys, device serials, nonce files, addresses or full phone logs. Windows ADB output is normalized with the tested android-text helper.

Connecting/unlocking the phone, approving real system permissions and subjective play are human boundaries. An offline station is a blocker, not an excuse to claim installation or use another host. No new GitHub login, Make bridge or self-hosted runner setup is assumed necessary.

## Play and protected operations

Read `docs/production/PLAY_RELEASE.ru.md`. `play-check` is only a fail-closed prerequisite inventory; `closeout` lists remaining work and unresolved ideas. Actual AAB pipeline, Publisher API adapter, live Play readback and store-installed validation are explicit tasks, not implemented by these checks.

Main/stable/production publication requires separate owner approval of the exact candidate; a modifiable JSON boolean is not approval. Account verification, real test participation/time, policy declarations and Google's review cannot be forged by automation. Preserve the free-only budget; do not buy account registration or services silently.

## Finish and handoff

Report exact changed branch/commit/PR, completed tests, actual artifact and install identity, unresolved gates and the next task. Use `report --write` and `handoff --write`; record sanitized observations in a docs-only follow-up, not a new unnecessary APK. Prepared, built, published, installed and human-accepted are different states.

Respect each current tool safety refusal and record the gap. Do not route a blocked operation through hidden shell code, another identity or computer. Authorized read-only inspection and preserving source are not permission to bypass a blocked release.

Previous full skill and historical examples: `docs/production/archive/game-production-v3.md`. Current task graph takes precedence over old roadmap numbering, while accepted source decisions remain authoritative.
