import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', 'src', 'renderer');
const destination = join(here, '..', 'dist', 'renderer');
await mkdir(destination, { recursive: true });
await cp(join(source, 'index.html'), join(destination, 'index.html'));
await cp(join(source, 'style.css'), join(destination, 'style.css'));
await cp(join(here, '..', 'assets', 'branding', 'holdvue-64.png'), join(destination, 'holdvue-icon.png'));
await cp(join(here, '..', 'assets', 'branding', 'holdvue-32.png'), join(destination, 'holdvue-favicon.png'));
await cp(join(here, '..', 'assets', 'branding', 'holdvue-256.png'), join(destination, 'holdvue-window-icon.png'));
