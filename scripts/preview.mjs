import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const renderer = join(root, 'dist', 'renderer', 'index.html');
const screenshotFlag = process.argv.indexOf('--screenshot');
const screenshotPath = screenshotFlag >= 0 ? process.argv[screenshotFlag + 1] : process.env.HOLDVUE_PREVIEW_SCREENSHOT;
if (screenshotFlag >= 0 && (!screenshotPath || screenshotPath.startsWith('--'))) {
  console.error('usage: electron scripts/preview.mjs [--screenshot <png-path>]');
  process.exit(2);
}
if (!existsSync(renderer)) {
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const ready = await Promise.race([
  app.whenReady().then(() => true),
  new Promise(resolve => setTimeout(() => resolve(false), 10_000))
]);
if (!ready) {
  console.error('preview Electron runtime did not become ready');
  app.exit(1);
  process.exit(1);
}
const window = new BrowserWindow({
  width: 1280,
  height: 900,
  title: 'HoldVue preview (synthetic)',
  show: !screenshotPath,
  backgroundColor: '#101216',
  webPreferences: {
    preload: join(root, 'scripts', 'preview-preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    offscreen: Boolean(screenshotPath),
    backgroundThrottling: false
  }
});
let loadFailure;
window.webContents.once('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
  if (isMainFrame) loadFailure = `${errorCode} ${errorDescription} (${validatedURL})`;
});
window.webContents.once('render-process-gone', (_event, details) => {
  loadFailure = `render-process-gone: ${details.reason}`;
});
window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
  if (level >= 2) console.error(`preview console ${sourceId}:${line}: ${message}`);
});
const loadPromise = window.loadFile(renderer).then(() => true).catch(error => {
  loadFailure = error instanceof Error ? error.message : 'load failed';
  return false;
});
if (screenshotPath) {
  // A headless CI desktop can delay did-finish-load indefinitely. Keep the
  // visual smoke command bounded while still waiting for the normal load path.
  const loaded = await Promise.race([loadPromise, new Promise(resolve => setTimeout(() => resolve(false), 10_000))]);
  if (!loaded) {
    console.error(`preview did not finish loading${loadFailure ? `: ${loadFailure}` : ''}`);
    app.exit(1);
    process.exit(1);
  }
} else {
  await loadPromise;
}
if (screenshotPath) {
  await Promise.race([
    window.webContents.executeJavaScript('document.fonts?.ready ?? Promise.resolve()').catch(() => undefined),
    new Promise(resolve => setTimeout(resolve, 2_000))
  ]);
  await new Promise(resolve => setTimeout(resolve, 500));
  const image = await Promise.race([
    window.webContents.capturePage({ stayHidden: true }),
    new Promise(resolve => setTimeout(() => resolve(null), 5_000))
  ]);
  if (!image) {
    console.error('preview capturePage timed out after did-finish-load');
    app.exit(1);
    process.exit(1);
  }
  await writeFile(screenshotPath, image.toPNG());
  console.error(`preview screenshot written: ${screenshotPath}`);
  app.exit(0);
}
app.on('window-all-closed', () => app.quit());
