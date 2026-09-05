# Android USB self-hosted runner

This runner installs the exact APK produced by the successful `dev` workflow, launches it on a USB-connected Android phone, captures a screenshot and uploads `logcat`.

## One-time Windows setup

1. Open the runner registration page:
   https://github.com/neurofoxpro/multimental/settings/actions/runners/new?arch=x64&os=win
2. Run the commands shown by GitHub in an empty directory such as `C:\actions-runner\multimental`.
3. During `config.cmd`, add the custom label `android-usb`.
4. Install the runner as a Windows service using the `svc.cmd install` and `svc.cmd start` commands from the runner directory.
5. Install GitHub CLI and authenticate if manual prerelease installation is needed:
   `winget install --id GitHub.cli`
6. Install Android SDK Platform-Tools and ensure `adb.exe` is available in `PATH` for the runner service account.
7. On the phone, enable Developer options and USB debugging, connect by USB and approve this computer.
8. Verify in PowerShell: `adb devices`. The device state must be `device`, not `unauthorized`.

The PC must remain powered on and the phone must remain connected for automatic device checks. The workflow never runs on pull requests and requires the trusted `dev` build to finish successfully first.

## Manual run

Open:
https://github.com/neurofoxpro/multimental/actions/workflows/device-smoke.yml

Choose `Run workflow`. Leave `tag` empty to install the latest prerelease or provide a specific prerelease tag.
