import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const branding = join(root, 'assets', 'branding');
const source = join(branding, 'holdvue-icon-master.png');
const icns = join(branding, 'holdvue.icns');
const ico = join(branding, 'holdvue.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];

if (!existsSync(source)) throw new Error('Branding source is missing.');
if (existsSync(icns) && existsSync(ico) && process.env.HOLDVUE_REBUILD_ICONS !== '1') {
  console.log('HoldVue icons already exist; set HOLDVUE_REBUILD_ICONS=1 to regenerate them.');
  process.exit(0);
}

const sips = process.platform === 'darwin' ? '/usr/bin/sips' : 'sips';
if (process.platform !== 'darwin') throw new Error('Regenerating ICNS/ICO requires macOS sips/iconutil; checked-in outputs remain usable on Windows CI.');

mkdirSync(branding, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'holdvue-icons-'));
try {
  const pngs = new Map();
  for (const size of sizes) {
    const destination = join(branding, `holdvue-${size}.png`);
    execFileSync(sips, ['-z', String(size), String(size), source, '--out', destination], { stdio: 'ignore' });
    pngs.set(size, readFileSync(destination));
  }
  const iconset = join(temporary, 'holdvue.iconset');
  mkdirSync(iconset);
  for (const [name, size] of [[16, 16], [32, 32], [128, 128], [256, 256], [512, 512]]) {
    const normal = join(iconset, `icon_${name}x${name}.png`);
    const retina = join(iconset, `icon_${name}x${name}@2x.png`);
    execFileSync(sips, ['-z', String(size), String(size), source, '--out', normal], { stdio: 'ignore' });
    execFileSync(sips, ['-z', String(size * 2), String(size * 2), source, '--out', retina], { stdio: 'ignore' });
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', icns], { stdio: 'ignore' });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.size, 4);
  const entries = []; const data = []; let offset = 6 + pngs.size * 16;
  for (const size of sizes) {
    const image = pngs.get(size);
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size; entry[1] = size === 256 ? 0 : size; entry[2] = 0; entry[3] = 0;
    entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(image.length, 8); entry.writeUInt32LE(offset, 12);
    entries.push(entry); data.push(image); offset += image.length;
  }
  writeFileSync(ico, Buffer.concat([header, ...entries, ...data]));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
