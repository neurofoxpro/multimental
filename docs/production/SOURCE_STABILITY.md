# Local verification source stability

Recovery on 2026-09-24 reproduced the older P05B issue on a fresh snapshot of 12fe5f15ff05586e9407b9c2021fa3abd3b8216d. All tests executed, but `gate verified` rejected the receipt as `stale_source`. Comparing main.gd with the canonical zip found exactly an indentation conversion: 0 tabs before, 297 after; replacing each tab with four spaces recovered the original bytes (apart from line-ending normalization). This is not evidence of changed game rules.

The station's editor settings use tab indentation and open the scene's root script. Godot documents automatic indentation conversion when saving a script. The Windows verification adapter now uses a private self-contained editor copy under the snapshot's `.gameprod/runtime/godot`, with conversion/autosave/script restoration disabled. It does not modify the global editor configuration or the original portable binary. Required private settings are checked on reuse rather than silently overwritten.

The production runner now checks the input fingerprint both before AND after a step. A command that exits 0 but modifies its declared source receives a failed receipt immediately; the source hash check is not weakened or normalized. Two regression tests exercise stable and mutating commands. The historical mutated snapshots are preserved for comparison; they are not used as release sources.

Sources: https://docs.godotengine.org/en/stable/classes/class_editorsettings.html#class-editorsettings-property-text-editor-behavior-files-convert-indent-on-save and https://docs.godotengine.org/en/stable/tutorials/io/data_paths.html#self-contained-mode.

The isolated local test and hosted CI results for this change must be observed in its PR before integration. Installed alpha.26.1 is left untouched while it is foreground. APK production remains on GitHub-hosted Linux; Android update script and signing identity are unchanged.
