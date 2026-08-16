import { basename } from 'node:path';
import { extractFile, listPackage } from '@electron/asar';

const archive = process.argv[2];
if (!archive) {
  console.error('usage: node scripts/audit-package.mjs <app.asar>');
  process.exit(2);
}

const forbiddenPath = /(?:^|\/)(?:test|tests|src|docs|fixture|\.env)(?:\/|\.|$)|holdvue-(?:state|secrets)|(?:\.backup\.json|\.bak)$/i;
const absoluteUserPath = new RegExp('(?:^|["\\s])/(?:Users|home)/[^"\\s]+|[A-Za-z]:\\\\Users\\\\');
const walletAddress = /0x[0-9a-f]{40}|bc1[a-z0-9]{25,}|(?:addr|stake)1[0-9a-z]{20,}|\b[13][1-9A-HJ-NP-Za-km-z]{25,34}\b|\b(?:xpub|ypub|zpub|tpub|upub|vpub)[1-9A-HJ-NP-Za-km-z]{20,}\b/i;
const secretPattern = /(?:BEGIN (?:RSA|OPENSSH|EC|PRIVATE) KEY|\b(?:sk|ghp|github_pat|xox[baprs]-)[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|\bBearer\s+[A-Za-z0-9._-]{20,}|\b(?:private[ _-]?key|mnemonic|seed[ _-]?phrase|access[ _-]?token)\s*[:=]\s*[^\s{}[\]]+)/i;
const secretStateField = /["'](?:privateKey|private_key|seedPhrase|seed_phrase|mnemonic|secretValue|apiKey|accessToken)["']\s*:/i;
const credentialUrl = /https?:\/\/[^\s/@:]+:[^\s/@]+@/i;
const credentialPath = /https?:\/\/[^\s/]+\/(?:v2|v3)\/[A-Za-z0-9_-]{8,}/i;
const textFile = /\.(?:js|json|mjs|cjs|md|html|css|txt|map)$/i;

const violations = [];
let entries;
try {
  entries = listPackage(archive);
} catch (error) {
  console.error(`cannot read ${basename(archive)}: ${error instanceof Error ? error.message : 'invalid archive'}`);
  process.exit(2);
}

for (const entry of entries) {
  if (forbiddenPath.test(entry)) violations.push({ entry, reason: 'forbidden-runtime-path' });
  if (/\.map$/i.test(entry)) violations.push({ entry, reason: 'source-map' });
  if (!textFile.test(entry)) continue;
  const packagePath = entry.replace(/^\/+/, '');
  let source;
  try {
    source = extractFile(archive, packagePath).toString('utf8');
  } catch (error) {
    violations.push({ entry, reason: 'unreadable-runtime-file' });
    continue;
  }
  if (absoluteUserPath.test(source)) violations.push({ entry, reason: 'absolute-user-path' });
  if (walletAddress.test(source)) violations.push({ entry, reason: 'wallet-address' });
  if (secretPattern.test(source)) violations.push({ entry, reason: 'secret-pattern' });
  if (secretStateField.test(source)) violations.push({ entry, reason: 'secret-state-field' });
  if (credentialUrl.test(source)) violations.push({ entry, reason: 'credential-url' });
  if (credentialPath.test(source)) violations.push({ entry, reason: 'credential-path' });
}

console.log(JSON.stringify({ archive: basename(archive), entries: entries.length, violations }, null, 2));
if (violations.length > 0) process.exit(1);
