# Multimental

Release-first prototype of a deterministic 3x3 multiversal elemental card battler for Android and Web.

## Development flow

`feature/*` -> `dev` -> `main`

- Every feature push and pull request runs headless verification and creates a signed debug APK artifact.
- Every successful push to `dev` publishes an Android prerelease.
- A configured Windows self-hosted runner installs the exact verified APK on a USB-connected phone and uploads screenshot/logcat diagnostics.

## Commands

```bash
npm run doctor
npm run verify
npm run build:android
npm run build:web
```

Windows device check:

```powershell
npm run device:smoke -- -ApkPath path\to\multimental.apk
```

Runner setup: [docs/device-runner.md](docs/device-runner.md)

Android package: `pro.neurofox.multimental`
