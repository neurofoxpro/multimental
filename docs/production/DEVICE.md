# Device delivery, tested hosts and signing

Canonical repository: neurofoxpro/multimental. Authorized personal execution host: VENEL-SENDRIK. Git/gh account venelsendrik has verified MAINTAIN/push access; no new browser authorization was needed. Main/stable require separate owner approval.

Read [OPS_V2_RESULTS.ru.md](OPS_V2_RESULTS.ru.md) for executed tests and actual installed version, [OPS_V2.ru.md](OPS_V2.ru.md) for commands, and [SKILL.md](../../skills/game-production/SKILL.md) before work.

GitHub-hosted CI builds arm64/x86_64 debug APKs. The station verifies canonical source/run/manifest/hash/package/version, then applies a persistent PRIVATE LOCAL development signature. The CI and installed APK hashes differ; both are recorded. Keys and device identifiers stay local. Production/Play signing is a separate future gate.

The owner explicitly authorized closing the development app for installation and testing. Station autoCloseForUpdate is enabled. Only pro.neurofox.multimental.dev is closed; update uses adb install -r and preserves app data. Clean uninstall is restricted to Multimental_Test_A/B after identity checks. Reinstall tests verify a persisted sentinel and settings.

Multimental-Dev-APK-Updater runs every five minutes as a limited interactive-user task. It downloads only approved dev APK/data, never new repository scripts. A test/qualification lease defers updates; a running installation is waited for with a bounded timeout. Live locks are not deleted. Exact-commit delivery in cycle/resume-cycle does not equate a zero exit code with the requested new installation.

Use scripts/chat.ps1 device-status, delivery, device-test, qualify and emulator. Detailed logs/screenshots/serial remain local. The reviewed updater copy is installed using deploy-agent; account permissions do not cause automatic execution of arbitrary remote scripts.

A running app and passing diagnostic transport are not full human gameplay acceptance or a finished PvP lobby. Real Wi-Fi and Bluetooth tests are recorded separately from USB tunnels and emulator bridges. Two actual phones were not available; physical Bluetooth proof is VENEL-SENDRIK adapter to the attached phone.
