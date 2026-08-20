import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeIconSourceHash } from './icon-source.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const branding = join(root, 'assets', 'branding');
const fullSource = join(branding, 'holdvue-icon.svg');
const smallSource = join(branding, 'holdvue-icon-small.svg');
const master = join(branding, 'holdvue-icon-master.png');
const icns = join(branding, 'holdvue.icns');
const ico = join(branding, 'holdvue.ico');
const manifest = join(branding, 'icon-build.json');
const pngSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024];
const icoSizes = pngSizes.filter(size => size <= 256);
const outputPaths = [master, icns, ico, ...pngSizes.map(size => join(branding, `holdvue-${size}.png`))];

if (!existsSync(fullSource) || !existsSync(smallSource)) throw new Error('HoldVue SVG branding sources are missing.');
const sourceHash = computeIconSourceHash(readFileSync(fullSource), readFileSync(smallSource));
let currentHash = '';
try { currentHash = JSON.parse(readFileSync(manifest, 'utf8')).sourceHash ?? ''; } catch { currentHash = ''; }
if (process.env.HOLDVUE_REBUILD_ICONS !== '1' && currentHash === sourceHash && outputPaths.every(existsSync)) {
  console.log('HoldVue icon outputs match the versioned SVG sources.');
  process.exit(0);
}
if (process.platform !== 'darwin') throw new Error('Branding sources changed. Regenerate checked-in ICNS/ICO outputs on macOS before packaging.');

const magickCandidates = ['/opt/homebrew/bin/magick', '/usr/local/bin/magick'];
const magick = magickCandidates.find(existsSync);
if (!magick) throw new Error('ImageMagick is required to render the versioned SVG branding sources.');

mkdirSync(branding, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'holdvue-icons-'));
const render = (source, size, destination) => execFileSync(magick, ['-background', 'none', '-density', '256', source, '-resize', `${size}x${size}`, '-strip', `PNG32:${destination}`], { stdio: 'ignore' });
const sourceForSize = size => size <= 48 ? smallSource : fullSource;

try {
  render(fullSource, 1024, master);
  const pngs = new Map();
  for (const size of pngSizes) {
    const destination = join(branding, `holdvue-${size}.png`);
    render(sourceForSize(size), size, destination);
    pngs.set(size, readFileSync(destination));
  }

  const iconset = join(temporary, 'holdvue.iconset');
  mkdirSync(iconset);
  for (const [name, size] of [[16, 16], [32, 32], [128, 128], [256, 256], [512, 512]]) {
    render(sourceForSize(size), size, join(iconset, `icon_${name}x${name}.png`));
    render(sourceForSize(size * 2), size * 2, join(iconset, `icon_${name}x${name}@2x.png`));
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', icns], { stdio: 'ignore' });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoSizes.length, 4);
  const entries = []; const data = []; let offset = 6 + icoSizes.length * 16;
  for (const size of icoSizes) {
    const image = pngs.get(size);
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size; entry[1] = size === 256 ? 0 : size; entry[2] = 0; entry[3] = 0;
    entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(image.length, 8); entry.writeUInt32LE(offset, 12);
    entries.push(entry); data.push(image); offset += image.length;
  }
  writeFileSync(ico, Buffer.concat([header, ...entries, ...data]));
  writeFileSync(manifest, `${JSON.stringify({ schemaVersion: 1, sourceHash, pngSizes }, null, 2)}\n`);
  console.log(`HoldVue icons regenerated from SVG sources (${sourceHash.slice(0, 12)}).`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
