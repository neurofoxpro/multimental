# Historical branch reconciliation

Observed on 2026-09-24: dev 6bbe697f4a2baca3f1878f9fa005bebe3f11c245 and bootstrap 1e878e02a7a7b677ca19e71ab7942afedaf5995a diverged from 03d4216cc8be799d0c4439cd2e7c71c151b0b7a5.

Compared the dev-side files. configure-android-ci.sh, stamp-build.mjs and device-runner.md are identical to recovered feature versions. New workflow/readme supersede the old equivalents with explicit recovery records. The dev texture import setting import_etc2_astc=true is retained in project.godot. A merge commit records both histories; no force-push, repository replacement or discarded branch history.

The first production CI caught a real receipt problem: Godot creates *.gd.uid files during import. The profile now explicitly classifies those generated sidecars and *.import as generated inputs; source .gd changes still invalidate receipts. A regression test covers this. This project uses path-based scene/script references; if UID files become hand-maintained inputs, remove that exclusion and version them explicitly.
