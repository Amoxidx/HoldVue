import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JsonFileStateStorage } from '../src/shared/storage.ts';
import { createEmptyPortfolioState, updateSettings } from '../src/shared/state.ts';

test('file storage starts empty, round-trips state, and rejects corrupt input safely', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'holdvue-test-'));
  const filename = join(directory, 'state.json');
  try {
    const storage = new JsonFileStateStorage(filename);
    assert.deepEqual((await storage.load()).positions, []);
    await storage.save(updateSettings(createEmptyPortfolioState(), { currency: 'USD' }));
    assert.equal((await storage.load()).settings.currency, 'USD');
    await writeFile(filename, '{not-json', 'utf8');
    assert.deepEqual((await storage.load()).wallets, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
