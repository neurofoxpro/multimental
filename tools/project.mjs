import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const game = join(root, "game");
const dist = join(root, "dist");
const godot = process.env.GODOT_BIN || (process.platform === "win32" ? "godot.exe" : "godot");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, ...(options.env || {}) },
  });

  if (result.error) {
    console.error(`Unable to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function doctor() {
  console.log(`Project: ${root}`);
  console.log(`Godot binary: ${godot}`);
  run(process.execPath, ["--version"]);
  run(godot, ["--version"]);

  const adb = process.platform === "win32" ? "adb.exe" : "adb";
  const adbResult = spawnSync(adb, ["version"], { stdio: "inherit", shell: false });
  if (adbResult.status !== 0) {
    console.warn("ADB is not available on PATH. This is only required for device commands.");
  }
}

function importProject() {
  run(godot, ["--headless", "--editor", "--path", game, "--quit-after", "20"]);
}

function test() {
  importProject();
  run(godot, ["--headless", "--path", game, "--script", "res://tests/smoke_test.gd"]);
}

function buildAndroid() {
  test();
  mkdirSync(dist, { recursive: true });
  run(godot, ["--headless", "--path", game, "--export-debug", "Android Debug", join(dist, "multimental-debug.apk")]);
}

function buildWeb() {
  test();
  const output = join(dist, "web", "index.html");
  mkdirSync(dirname(output), { recursive: true });
  run(godot, ["--headless", "--path", game, "--export-debug", "Web", output]);
}

const [command, target] = process.argv.slice(2);

switch (command) {
  case "doctor":
    doctor();
    break;
  case "verify":
  case "test":
    test();
    break;
  case "build":
    if (target === "android") buildAndroid();
    else if (target === "web") buildWeb();
    else {
      console.error("Usage: node tools/project.mjs build <android|web>");
      process.exit(2);
    }
    break;
  default:
    console.error("Usage: node tools/project.mjs <doctor|verify|test|build>");
    process.exit(2);
}
