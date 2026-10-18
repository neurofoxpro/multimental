import { classify } from '../skills/game-production/scripts/policy.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJSON, writeJSON, context, findRoot } from '../skills/game-production/scripts/lib.mjs';
import {
  baseVersion,
  validateChange,
  readChanges,
  renderChangelog,
  renderReleaseNotes
} from '../skills/game-production/scripts/changelog-lib.mjs';
const root = findRoot(),
  p = readJSON(path.join(root, '.gameprod/project.json')),
  pkg = readJSON(path.join(root, 'package.json'));
const [command = 'check', ...args] = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i < 0 ? fallback : args[i + 1];
};
function render() {
  return renderChangelog(readChanges(root), {
    currentVersion: pkg.version,
    repository: p.repository
  });
}
try {
  switch (command) {
    case 'add': {
      context(root, p);
      const item = {
        id: option('id'),
        version: option('version', baseVersion(pkg.version)),
        kind: option('kind', 'changed'),
        scope: option('scope', 'automation'),
        text: option('text'),
        breaking: args.includes('--breaking')
      };
      validateChange(item);
      const file = path.join(root, 'changes/fragments', item.id + '.json');
      if (fs.existsSync(file))
        throw Error('ID уже существует; существующую запись не перезаписываем');
      writeJSON(file, item);
      fs.writeFileSync(path.join(root, 'CHANGELOG.ru.md'), render());
      console.log('CHANGELOG_ENTRY_ADDED ' + item.id);
      break;
    }
    case 'render':
      context(root, p);
      fs.writeFileSync(path.join(root, 'CHANGELOG.ru.md'), render());
      console.log('CHANGELOG_RENDERED');
      break;
    case 'check': {
      const actual = fs
        .readFileSync(path.join(root, 'CHANGELOG.ru.md'), 'utf8')
        .replaceAll('\r\n', '\n');
      if (actual !== render()) throw Error('CHANGELOG.ru.md устарел: выполните changelog render');
      if (!readChanges(root).some((x) => x.version === baseVersion(pkg.version)))
        throw Error('Нет записей для текущей версии');
      console.log('RUSSIAN_CHANGELOG_PASS');
      break;
    }
    case 'policy': {
      if (!process.env.GITHUB_EVENT_PATH) {
        console.log('CHANGELOG_POLICY_LOCAL_CHECK_ONLY');
        break;
      }
      const event = readJSON(process.env.GITHUB_EVENT_PATH);
      const base = event.pull_request?.base?.sha || event.before;
      if (!base || /^0+$/.test(base)) {
        console.log('CHANGELOG_POLICY_INITIAL_IMPORT');
        break;
      }
      if (!/^[a-f0-9]{40}$/.test(base)) throw Error('Некорректный base SHA');
      const diff = spawnSync('git', ['diff', '--name-only', base, 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 10000
      });
      if (diff.status !== 0) throw Error('Не удалось проверить изменения');
      const files = diff.stdout.trim().split('\n').filter(Boolean);
      if (
        classify(files).needsApk &&
        !files.some((x) => /^changes\/fragments\/[a-z0-9-]+\.json$/.test(x))
      )
        throw Error('Изменения кода требуют новой/обновлённой русской записи changes/fragments');
      console.log('CHANGELOG_COVERAGE_PASS');
      break;
    }
    case 'release': {
      context(root, p);
      const manifestPath = option('manifest', 'artifacts/build-manifest.json'),
        manifest = readJSON(path.resolve(root, manifestPath));
      if (manifest.repository !== p.repository) throw Error('Чужой manifest');
      const baseRef = option('base', process.env.CHANGELOG_BASE || null);
      let baseline = [];
      if (baseRef) {
        if (!/^[a-f0-9]{40}$/.test(baseRef)) throw Error('В --base нужен commit SHA');
        const tree = spawnSync(
          'git',
          ['ls-tree', '-r', '--name-only', baseRef, '--', 'changes/fragments'],
          { cwd: root, encoding: 'utf8', timeout: 10000 }
        );
        if (tree.status === 0)
          for (const f of tree.stdout
            .trim()
            .split('\n')
            .filter((x) => x.endsWith('.json'))) {
            const file = spawnSync('git', ['show', baseRef + ':' + f], {
              cwd: root,
              encoding: 'utf8',
              timeout: 10000
            });
            if (file.status === 0) baseline.push(JSON.parse(file.stdout));
          }
      }
      const output = path.join(root, 'artifacts/RELEASE_NOTES.ru.md');
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(
        output,
        renderReleaseNotes(readChanges(root), {
          version: manifest.version,
          commit: manifest.commit,
          repository: p.repository,
          manifest,
          baseChanges: baseline
        })
      );
      console.log('RUSSIAN_RELEASE_NOTES_READY');
      break;
    }
    default:
      throw Error('changelog: add|render|check|release');
  }
} catch (e) {
  console.error('CHANGELOG_BLOCKED: ' + e.message);
  process.exitCode = 1;
}
