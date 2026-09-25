# Multimental: mandatory production entry point

For a new chat first read NEXT_CHAT.ru.md when present, then refresh live state with scripts/chat.cmd resume. Handoff is timestamped evidence, not permission to skip gates.

Read `docs/production/AUTHORITY.md`, `.gameprod/project.json`, `.gameprod/state.json`, `.gameprod/decisions.json` and `skills/game-production/SKILL.md` before acting.

Only repository: `neurofoxpro/multimental`. Only authorized personal execution host: `VENEL-SENDRIK`. GitHub-hosted CI is allowed for this repository. Never select another online computer as a fallback. Never create/transfer/mirror/delete repositories or force-push. Preserve existing work.

Use the skill scripts for metadata, tests, build receipts and Android installation. Code written is not code tested; APK built is not APK installed; installed is not human gameplay accepted. Record actual command outputs, exact source commit, artifact hash and unresolved gates.

Recommended low-risk defaults are delegated. Ask one genuinely blocking question at a time. Main integration, stable publication, destructive changes and changes of accepted concept require owner approval. Work in feature branches, integrate to dev only after passing CI. Keep credentials, device serials and full phone logs out of public Git.

## Unified task entry point

Use `npm run game -- next`, then `npm run game -- task TASK-ID`; on VENEL-SENDRIK the equivalent is `scripts/chat.cmd`. Read `.gameprod/workplan.json` and `docs/production/CONTROL.ru.md`. The workplan is canonical; requirements/backlog/roadmap are generated projections, not independent planning databases.

Use `start TASK-ID` → implement and test the accepted change → `check` → `ship TASK-ID`. The controller delegates to the existing guarded ops cycle. It does not implement missing gameplay or bypass candidate qualification. After interruption inspect `resume`, then the specific resumable step.

Capture new proposals with `idea IDEA-001 "text"`; link them to a reviewed workplan task or an explicit decision. Do not invent the owner's deferred special mechanic or reinterpret rating rules. `play-check` and `closeout` are inventories and never authorization to publish. Historical verified records are not fresh RC receipts. No reconfiguration of GitHub or a generic personal self-hosted runner is required.
