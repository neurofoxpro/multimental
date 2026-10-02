# Verified station toolchain

Portable tools are contained under the authorized user's MultimentalWork/tools directory. No system-wide Godot/Git installation or other computer is needed. Source is obtained as a pinned canonical commit snapshot; writes use the connected GitHub API.

Godot: 4.7.2 standard Windows editor, exact SHA256 731980f9608d61333e5baf54a2ef17210acc7a538446c0cb9969f002aca1e953. Hosted Linux and export-template hashes remain pinned in setup-godot.sh.

ADB platform tools: 37.0.1; Windows archive SHA256 45f4d63113e895ebde0c90f194099a4676b6ac653bd28d54314a9e022bbc1a99.

Android build-tools: 35.0.1; Windows archive SHA256 79748cb4ab64b61fa678af21639985c7e394d874a4e31f082f4026d5c57e01a3.

Portable Temurin JRE: 17.0.20.1+1; Windows archive SHA256 bc21a93923103cdaac93ee337b0ae4365e739fde36df823dd456bc67c8a9d352. It supplies java/keytool for private local signing; no production key is created.

bootstrap-station.ps1 reuses matching archives and rejects mismatches. If a provider's latest metadata changes, a clean bootstrap intentionally fails until the lock is reviewed; it does not silently adopt a new binary. Existing installed tools remain usable without redownload. CI is the Android SDK/export-template build environment; station needs only verification/signing/ADB.

Headless test receipts are bound to source bytes. A local main.gd copy changed indentation after a test run; the guard correctly marked it stale. The published APK comes from the successful GitHub CI commit, not that modified local copy.
