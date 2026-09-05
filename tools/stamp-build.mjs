import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [version, commit, buildLabel, buildCodeRaw] = process.argv.slice(2);
const buildCode = Number.parseInt(buildCodeRaw ?? "", 10);

if (!version || !commit || !buildLabel || !Number.isSafeInteger(buildCode) || buildCode < 1) {
  console.error("Usage: node tools/stamp-build.mjs <version> <commit> <build-label> <positive-build-code>");
  process.exit(2);
}

const root = resolve(import.meta.dirname, "..");
const buildInfoPath = resolve(root, "game/src/build_info.gd");
const presetsPath = resolve(root, "game/export_presets.cfg");
const projectPath = resolve(root, "game/project.godot");

writeFileSync(
  buildInfoPath,
  `class_name BuildInfo\nextends RefCounted\n\nconst VERSION: String = ${JSON.stringify(version)}\nconst COMMIT: String = ${JSON.stringify(commit)}\nconst BUILD_NUMBER: String = ${JSON.stringify(buildLabel)}\n`,
  "utf8",
);

let presets = readFileSync(presetsPath, "utf8");
presets = presets.replace(/^version\/code=\d+$/m, `version/code=${buildCode}`);
presets = presets.replace(/^version\/name="[^"]*"$/m, `version/name=${JSON.stringify(version)}`);
writeFileSync(presetsPath, presets, "utf8");

let project = readFileSync(projectPath, "utf8");
project = project.replace(/^config\/version="[^"]*"$/m, `config/version=${JSON.stringify(version)}`);
writeFileSync(projectPath, project, "utf8");

console.log(`Stamped Multimental ${version} (${commit}, build ${buildLabel}, Android code ${buildCode})`);
