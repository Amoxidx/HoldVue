import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { createRendererController } from '../src/renderer/renderer-app.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const screen = process.argv[2] ?? 'dashboard';
const theme = process.argv[3] === 'light' ? 'light' : 'dark';
const allowed = new Set(['dashboard', 'expanded', 'settings', 'wallet', 'holding']);
if (!allowed.has(screen)) throw new Error(`Unsupported static preview screen: ${screen}`);

const htmlPath = join(root, 'dist', 'renderer', 'index.html');
const output = join(root, 'dist', 'renderer', `preview-${screen}-${theme}.html`);
const fixture = JSON.parse(await readFile(join(root, 'test', 'fixtures', 'portfolio-preview.json'), 'utf8'));
fixture.settings.theme = theme;
const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: pathToFileURL(htmlPath).href });
for (const dialog of dom.window.document.querySelectorAll('dialog')) {
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
}
const success = value => ({ ok: true, value });
const api = {
  async getState() { return success(fixture); }, async updateSettings() { return success(fixture); }, async refresh() { return success(fixture); },
  async detectWalletAddress() { return { ok: false, code: 'unsupported', message: 'Synthetic preview.' }; }, async addWallet() { return success(fixture); }, async updateWallet() { return success(fixture); }, async deleteWallet() { return success(fixture); }, async copyWalletAddress() { return success({ copied: true }); },
  async searchInstruments() { return success([]); }, async addHolding() { return success(fixture); }, async updateHolding() { return success(fixture); }, async deleteHolding() { return success(fixture); },
  async setEtherscanKey() { return success(fixture); }, async deleteEtherscanKey() { return success(fixture); }, async setFmpKey() { return success(fixture); }, async deleteFmpKey() { return success(fixture); }, onMinute() { return () => undefined; }
};
const controller = createRendererController(dom.window.document, api); controller.start(); await controller.render();
if (screen === 'expanded') { dom.window.document.querySelector('[data-portfolio-range="MAX"]')?.click(); dom.window.document.querySelector('[data-asset-disclosure]')?.click(); }
if (screen === 'settings') dom.window.document.querySelector('[data-open-settings]')?.click();
if (screen === 'wallet') dom.window.document.querySelector('[data-add-wallet]')?.click();
if (screen === 'holding') dom.window.document.querySelector('[data-add-holding]')?.click();
if (screen === 'settings' || screen === 'wallet' || screen === 'holding') {
  dom.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.remove();
  const dialog = dom.window.document.querySelector(`dialog[data-${screen === 'settings' ? 'settings' : screen === 'wallet' ? 'wallet' : 'holding'}-dialog]`);
  const main = dom.window.document.querySelector('main');
  if (main) { main.style.opacity = '.24'; main.style.filter = 'blur(3px)'; }
  if (dialog) { dialog.style.position = 'fixed'; dialog.style.inset = '24px auto auto 50%'; dialog.style.zIndex = '100'; dialog.style.display = 'block'; dialog.style.transform = 'translateX(-50%)'; }
}
dom.window.document.querySelector('script[src="renderer.js"]')?.remove();
await writeFile(output, dom.serialize());
console.log(output);
