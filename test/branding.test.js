import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import { computeIconSourceHash } from '../scripts/icon-source.mjs';

const branding = new URL('../assets/branding/', import.meta.url);
const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024];

function decodeRgbaPng(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
  const width = buffer.readUInt32BE(16); const height = buffer.readUInt32BE(20);
  assert.equal(buffer[24], 8); assert.equal(buffer[25], 6);
  let offset = 8; const chunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset); const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(chunks)); const stride = width * 4; const pixels = Buffer.alloc(stride * height); let source = 0;
  const paeth = (a, b, c) => { const estimate = a + b - c; const da = Math.abs(estimate - a); const db = Math.abs(estimate - b); const dc = Math.abs(estimate - c); return da <= db && da <= dc ? a : db <= dc ? b : c; };
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source++]; const row = y * stride; const previous = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[source++]; const left = x >= 4 ? pixels[row + x - 4] : 0; const above = y > 0 ? pixels[previous + x] : 0; const upperLeft = y > 0 && x >= 4 ? pixels[previous + x - 4] : 0;
      pixels[row + x] = filter === 0 ? value : filter === 1 ? (value + left) & 255 : filter === 2 ? (value + above) & 255 : filter === 3 ? (value + Math.floor((left + above) / 2)) & 255 : (value + paeth(left, above, upperLeft)) & 255;
    }
  }
  return { width, height, pixels };
}

test('branding outputs are current, adaptive, transparent and package-ready', async () => {
  const fullSource = await readFile(new URL('holdvue-icon.svg', branding)); const smallSource = await readFile(new URL('holdvue-icon-small.svg', branding));
  assert.match(fullSource.toString(), /viewBox="0 0 1024 1024"/); assert.match(smallSource.toString(), /viewBox="0 0 1024 1024"/);
  const expectedHash = computeIconSourceHash(fullSource, smallSource);
  const manifest = JSON.parse(await readFile(new URL('icon-build.json', branding), 'utf8'));
  assert.equal(manifest.sourceHash, expectedHash); assert.deepEqual(manifest.pngSizes, sizes);
  for (const size of sizes) {
    const image = decodeRgbaPng(await readFile(new URL(`holdvue-${size}.png`, branding)));
    assert.equal(image.width, size); assert.equal(image.height, size); assert.equal(image.pixels[3], 0, `top-left alpha at ${size}px`);
    assert.equal(image.pixels[(size * size - 1) * 4 + 3], 0, `bottom-right alpha at ${size}px`);
    assert.ok(image.pixels.some((value, index) => index % 4 === 3 && value > 0), `visible pixels at ${size}px`);
  }
  const master = decodeRgbaPng(await readFile(new URL('holdvue-icon-master.png', branding)));
  assert.equal(master.width, 1024); assert.equal(master.height, 1024); assert.equal(master.pixels[3], 0);
  const ico = await readFile(new URL('holdvue.ico', branding)); assert.equal(ico.readUInt16LE(4), 10);
  const icoSizes = Array.from({ length: 10 }, (_, index) => ico[6 + index * 16] || 256); assert.deepEqual(icoSizes, sizes.filter(size => size <= 256));
  const icns = await readFile(new URL('holdvue.icns', branding)); assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns');
});

test('branding source hashes are stable across LF and CRLF checkouts', () => {
  const full = '<svg>\n<path />\n</svg>\n';
  const small = '<svg>\n<circle />\n</svg>\n';
  assert.equal(
    computeIconSourceHash(full, small),
    computeIconSourceHash(full.replaceAll('\n', '\r\n'), small.replaceAll('\n', '\r\n')),
  );
});
