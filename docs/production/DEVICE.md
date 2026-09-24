# Device delivery and explicit signing boundary

Only VENEL-SENDRIK is authorized. The attached paired phone is selected by a private local configuration. ADB serial, signing identity and detailed logs are never committed.

The GitHub-connected account on this computer currently has read access, not write/admin. GitHub source changes are made through the chat connector. We do not ask for broad tokens or connect another computer.

GitHub-hosted CI validates and exports an ephemeral-debug-signed `.dev` APK. The device station verifies the canonical release and successful dev workflow, original SHA-256, actual Android package and version using aapt, then applies a **persistent private local development key** using apksigner. This is an explicit packaging transform: the downloaded APK hash and installed APK hash differ and both are retained. We do not claim the re-signed APK is bit-identical to the CI APK. Production signing and a globally updatable Play release remain a later protected step. No key is published in Git or artifacts.

`install-device.mjs` installs in place, checks process/version/readiness, records receipt and app-scoped diagnostics. It never uninstalls/clears data to work around signatures. The private local signing folder must be backed up by the owner before moving test stations.

`update-device.mjs --config LOCAL_CONFIG` checks successful canonical dev prereleases only; downloads APK and manifest, never remote scripts. It defers when the game is foreground and records successful SHA to skip repeat installs. Lockfiles prevent overlapping runs. It does not start arbitrary GitHub workflows on the PC.

`scripts/register-updater.ps1` registers a limited per-user Windows task every five minutes while logged in. Config and reviewed scripts are installed outside source snapshots under MultimentalWork/agent. To stop: disable the named task `Multimental-Dev-APK-Updater`; to remove it use the script's -Remove switch. Missing phone/authorization fails without modifying the phone.

A successful install is not human acceptance. Manual checks: launch, switch RU/EN, play cards, attack an adjacent opponent, win/lose, return from background, and report readability/tempo problems. Never claim Bluetooth, shop or drafting are present in this first release.
