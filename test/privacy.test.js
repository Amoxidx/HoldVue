import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createEmptyPortfolioState } from '../src/shared/state.ts';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
// Electron-builder output is audited separately at the package boundary.
// Keep this source-tree exclusion narrow: only the gitignored release folder
// is omitted, while package contents are checked by scripts/audit-package.mjs.
const ignored = new Set(['node_modules', '.git', 'coverage', 'release']);

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const target = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(target));
    else result.push(target);
  }
  return result;
}

test('public tree rejects private artefacts, user paths, addresses, and non-empty defaults', async () => {
  const contents = await files(rootPath);
  const forbiddenArtifact = /\.(?:pem|key|p12|pfx|sqlite|db|tgz|zip|dmg)$/i;
  const absoluteUserPath = new RegExp('(?:^|["\\s])/(?:Users|home)/[^"\\s]+|[A-Za-z]:\\\\Users\\\\');
  const walletAddress = /0x[0-9a-f]{40}|bc1[a-z0-9]{25,}|(?:addr|stake)1[0-9a-z]{20,}|\b[13][1-9A-HJ-NP-Za-km-z]{25,34}\b|\b(?:xpub|ypub|zpub|tpub|upub|vpub)[1-9A-HJ-NP-Za-km-z]{20,}\b/i;
  const secretPattern = /(?:BEGIN (?:RSA|OPENSSH|EC|PRIVATE) KEY|\b(?:sk|ghp|github_pat|xox[baprs]-)[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|\bBearer\s+[A-Za-z0-9._-]{20,}|\b(?:private[ _-]?key|mnemonic|seed[ _-]?phrase|access[ _-]?token)\s*[:=]\s*[^\s{}[\]]+)/i;
  const credentialPath = /https?:\/\/[^\s/]+\/(?:v2|v3)\/[A-Za-z0-9_-]{8,}/i;
  const secretStateField = /["'](?:privateKey|private_key|seedPhrase|seed_phrase|mnemonic|secretValue|apiKey|accessToken)["']\s*:/i;
  const credentialUrl = /https?:\/\/[^\s/@:]+:[^\s/@]+@/i;
  for (const filename of contents) {
    assert.equal(forbiddenArtifact.test(filename), false, filename);
    const binaryBranding = /\.(?:png|icns|ico)$/i.test(filename);
    const source = binaryBranding ? '' : await readFile(filename, 'utf8');
    assert.equal(absoluteUserPath.test(source), false, filename);
    assert.equal(secretStateField.test(source), false, filename);
    assert.equal(credentialUrl.test(source), false, filename);
    assert.equal(credentialPath.test(source), false, filename);
    if (basename(filename) !== 'package-lock.json') {
      assert.equal(walletAddress.test(source), false, filename);
      assert.equal(secretPattern.test(source), false, filename);
    }
  }
  const empty = createEmptyPortfolioState();
  assert.deepEqual(empty.positions, []);
  assert.deepEqual(empty.wallets, []);
  assert.equal(JSON.stringify(empty).toLowerCase().includes('solana'), false);
  assert.equal(secretStateField.test(JSON.stringify(empty)), false);
  assert.equal(credentialUrl.test(JSON.stringify(empty)), false);
  assert.equal(credentialPath.test(JSON.stringify(empty)), false);
  const fixture = await readFile(join(rootPath, 'test', 'fixtures', 'synthetic-state.json'), 'utf8');
  assert.match(fixture, /schemaVersion/);
  assert.doesNotMatch(fixture, /solana|(?:wallet|account)?address\s*:/i);
  const build = spawnSync('npm', ['run', 'build'], { cwd: rootPath, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const pack = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: rootPath, encoding: 'utf8' });
  assert.equal(pack.status, 0, pack.stderr);
  const packReport = JSON.parse(pack.stdout)[0];
  const packFiles = packReport.files.map(file => file.path);
  assert.equal(packFiles.some(file => file === 'dist/main.js'), true);
  assert.equal(packFiles.some(file => file === 'dist/preload.js'), true);
  assert.equal(packFiles.some(file => file === 'dist/renderer/index.html'), true);
  assert.equal(packFiles.some(file => /\.(?:pem|key|p12|pfx|sqlite|db)$/i.test(file)), false);
  assert.equal(packFiles.some(file => /^(?:test|docs|\.env)/.test(file)), false);
  assert.equal(packFiles.some(file => /(?:holdvue-state|\.backup\.json|\.bak$|\.(?:tgz|zip|dmg)$)/i.test(file)), false);
  for (const file of packFiles) {
    if (!/\.(?:js|json|md|mjs|ts|html|css|txt|example|map)$/i.test(file)) continue;
    const source = await readFile(join(rootPath, file), 'utf8');
    assert.equal(absoluteUserPath.test(source), false, `packed ${file}`);
    assert.equal(walletAddress.test(source), false, `packed ${file}`);
    assert.equal(secretStateField.test(source), false, `packed ${file}`);
    assert.equal(credentialUrl.test(source), false, `packed ${file}`);
    assert.equal(credentialPath.test(source), false, `packed ${file}`);
    if (basename(file) !== 'package-lock.json') assert.equal(secretPattern.test(source), false, `packed ${file}`);
  }
  const reachable = spawnSync('git', ['rev-list', '--objects', '--all'], { cwd: rootPath, encoding: 'utf8' });
  assert.equal(reachable.status, 0, reachable.stderr);
  const objectPaths = new Map(reachable.stdout.split('\n').filter(Boolean).map(line => {
    const separator = line.indexOf(' ');
    return separator < 0 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)];
  }));
  const objects = spawnSync('git', ['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)'], { cwd: rootPath, encoding: 'utf8' });
  assert.equal(objects.status, 0, objects.stderr);
  for (const line of objects.stdout.split('\n').filter(Boolean)) {
    const [objectId, type] = line.split(' ');
    if (type !== 'blob' || !objectId) continue;
    const objectPath = objectPaths.get(objectId) ?? '';
    if (/\.(?:png|icns|ico)$/i.test(objectPath)) continue;
    const blob = spawnSync('git', ['cat-file', 'blob', objectId], {
      cwd: rootPath,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    });
    assert.equal(blob.status, 0, blob.stderr);
    if (basename(objectPath) !== 'package-lock.json') {
      assert.equal(walletAddress.test(blob.stdout), false, `git object ${objectId}`);
      assert.equal(secretPattern.test(blob.stdout), false, `git object ${objectId}`);
    }
  }
});
