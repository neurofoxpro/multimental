# Authority and execution boundary

Updated: 2026-09-24. Source: owner's latest instruction in the Multimental project conversation.

- The only project repository is `neurofoxpro/multimental`.
- The only authorized personal execution machine is `VENEL-SENDRIK`.
- GitHub-hosted CI may build and test this repository.
- The attached, explicitly selected Android device may receive verified development APK updates.
- Other personal computers and other project repositories are outside scope.
- Do not create, transfer, delete or mirror repositories as a fallback.
- Stop on an unexpected Git remote or hostname; report the exact mismatch.
- Keep credentials and device identifiers out of public logs and commits.
- Work on feature branches; integration to dev requires passing checks. Stable publication and main integration still require separate owner approval.
- No assertion of build, installation, test pass or publication without an observed result and receipt.
- Existing source is recovered from `feature/bootstrap-release-pipeline` at `1e878e02a7a7b677ca19e71ab7942afedaf5995a` without deleting its history.

Latest owner authorization supersedes earlier suggestions involving other computers or repositories. Technical readiness, installation and human gameplay acceptance are separate gates.

## Updated authorizations, latest owner messages
The owner authorized the venelsendrik Git/gh account on VENEL-SENDRIK, automated app closing/reinstallation/relaunch, emulator-first tests, LAN/physical Bluetooth diagnostics and use of the newly attached Bluetooth adapter. This does not authorize another computer, repository or deletion of phone app data. Use in-place updates on the phone; clean installation belongs to dedicated emulators.

## Owner delegation of 25 September 2026 — Issue-first automation

The owner's subsequent explicit instructions permit automatic development-branch integration after applicable automated tests, and require that a disconnected phone not block source development or development releases. This supersedes the older mandatory-station-qualification gate for ordinary dev integration. It does not mark unperformed device checks as passed or authorize production.

GitHub Issues are now the primary task/decision memory, with #29 as the index. Repository planning documents remain reviewed snapshots. Source changes and cloud tests can progress without the phone; device delivery and real-radio acceptance retain their own evidence.

Merged-branch cleanup is requested, but only after checking exact tip, canonical merged PR, ancestry and absence of active work. Unmerged branches, main/dev and active working trees are not cleanup candidates. No force-push or phone data deletion is authorized.

The flow reports missing adapters instead of relaxing guards. PR92 deployed and exercised the exact PR source-seal. The next independently tested increment enables local settle on the authorized station, using the owner's existing dev delegation. Cloud execution of this merge command remains denied; a permanently running service and production approvals are not inferred from local command availability.
