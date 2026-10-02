# Local verification source stability

Recovery on 2026-09-24 reproduced P05B on a fresh snapshot of 12fe5f15ff05586e9407b9c2021fa3abd3b8216d. All tests executed, but the subsequent gate was stale_source. Comparing main.gd with the canonical zip found an indentation conversion: 0 tabs before, 297 after; four-space tab expansion recovered the original text. This is not evidence of changed game rules.

The station's editor settings use tabs and open the root scene script. Godot documents indent conversion on save. The Windows verification adapter now uses a private self-contained editor copy under the snapshot's .gameprod/runtime/godot, with indent conversion, script restoration and save-on-focus-loss disabled and explicit four-space indentation. It does not modify the user's global configuration or original portable binary.

An initial repeat test also found that the pinned 4.7.2 editor omits default-valued/obsolete settings on save and stores save-on-focus-loss under interface/editor/behavior/. The adapter now checks the actual retained properties, not obsolete aliases or presence of defaults. Code fingerprints are never normalized or ignored.

The production runner compares inputs before and after every step. A command exiting 0 but modifying source receives a FAILED receipt immediately. Two regression tests exercise mutating/stable commands. Historical mutated snapshots are kept and are not release sources.

References: https://docs.godotengine.org/en/stable/classes/class_editorsettings.html#class-editorsettings-property-text-editor-behavior-files-convert-indent-on-save and https://docs.godotengine.org/en/stable/tutorials/io/data_paths.html#self-contained-mode.

Local repeat tests and hosted CI must pass before dev integration. No Android gameplay, updater or signing identity change is introduced by this fix. A missing Android SDK warning in the isolated local editor is not an Android build result: actual APK compilation remains on GitHub-hosted Linux.
