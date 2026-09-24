import fs from 'node:fs';
import path from 'node:path';
import {context, inside, readJSON, sha, writeJSON} from '../skills/game-production/scripts/lib.mjs';

// Windows has no supported XDG override. Use a private self-contained editor
// copy in this checkout, leaving the installed editor and user settings alone.
export function verificationRuntime(root, executable) {
  if (process.platform !== 'win32') return executable;
  const p = readJSON(inside(root, '.gameprod/project.json'));
  context(root, p);
  if (!path.isAbsolute(executable) || !fs.existsSync(executable)) {
    throw Error('Windows verification requires an absolute GODOT_BIN');
  }
  const basename = path.basename(executable);
  if (!/^Godot_v4\.7\.2-stable_win64(?:_console|\.console)?\.exe$/i.test(basename)) {
    throw Error('Unexpected local Godot binary; review the pinned tool adapter');
  }
  const target = inside(root, '.gameprod/runtime/godot');
  const ownerFile = path.join(target, 'runtime-owner.json');
  const binaryHash = sha(fs.readFileSync(executable));
  if (fs.existsSync(target)) {
    const owner = readJSON(ownerFile);
    if (owner.repository !== p.repository || owner.binaryHash !== binaryHash) {
      throw Error('Private editor runtime belongs to different inputs');
    }
  } else {
    fs.mkdirSync(target, {recursive: true});
    writeJSON(ownerFile, {repository: p.repository, binaryHash});
  }
  const names = new Set([basename, basename.replace(/(?:_console|\.console)\.exe$/i, '.exe')]);
  for (const name of names) {
    const src = path.join(path.dirname(executable), name);
    const dst = path.join(target, name);
    if (!fs.existsSync(src)) throw Error('Godot console companion missing');
    if (fs.existsSync(dst)) {
      if (sha(fs.readFileSync(src)) !== sha(fs.readFileSync(dst))) throw Error('Private editor binary changed');
    } else fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
  }
  const marker = path.join(target, '_sc_');
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, '', {flag: 'wx'});
  const settings = path.join(target, 'editor_data', 'editor_settings-4.7.tres');
  const required = {
    'text_editor/behavior/indent/type': '1',
    'text_editor/behavior/indent/size': '4',
    'text_editor/behavior/files/convert_indent_on_save': 'false',
    'text_editor/behavior/files/open_dominant_script_on_scene_change': 'false',
    'text_editor/behavior/files/restore_scripts_on_load': 'false',
    'text_editor/behavior/files/autosave_interval_secs': '0',
    'interface/editor/save_on_focus_loss': 'false'
  };
  if (!fs.existsSync(settings)) {
    fs.mkdirSync(path.dirname(settings), {recursive: true});
    fs.writeFileSync(settings, '[gd_resource type="EditorSettings" format=3]\n\n[resource]\n' +
      Object.entries(required).map(([key, value]) => key + ' = ' + value).join('\n') + '\n', {flag: 'wx'});
  } else {
    const actual = Object.fromEntries(fs.readFileSync(settings, 'utf8').split(/\r?\n/)
      .map(line => line.match(/^([^=]+?)\s*=\s*(.*?)\s*$/)).filter(Boolean)
      .map(match => [match[1].trim(), match[2]]));
    for (const [key, value] of Object.entries(required)) {
      if (actual[key] !== value) throw Error('Private editor setting changed: ' + key);
    }
  }
  console.log('LOCAL_GODOT_ISOLATED');
  return path.join(target, basename);
}
