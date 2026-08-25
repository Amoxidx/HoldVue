import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeBase58Check } from '../src/shared/addresses.ts';
import { parsePortfolioState } from '../src/shared/state.ts';
import { createSyncCoordinator, reconcileSync } from '../src/shared/sync.ts';

const address = `0x${'1'.repeat(40)}`;
function state(enabledProviderIds = ['evm']) {
  return parsePortfolioState({ schemaVersion: 3, settings: { enabledProviderIds, enabledChainIds: [], providerEndpoints: [], providerRefs: [] }, wallets: [{ id: 'wallet-sync', label: 'Synthetic sync', family: 'evm', address, enabled: true, createdAt: 1, options: { autoScanCommonChains: false, chainIds: [1] } }], positions: [] });
}
function draft(baseUnits = '42') { return { family: 'evm', chainId: 1, assetKind: 'native', assetId: 'native:1', symbol: 'ETH', baseUnits, decimals: 18 }; }
function adapter(result, delay = 0) { return { family: 'evm', providerId: 'evm', async scan() { if (delay) await new Promise(resolve => setTimeout(resolve, delay)); return result; } }; }
function success(baseUnits = '42') { return { family: 'evm', providerId: 'evm', status: 'ok', capability: 'native-complete', positions: [draft(baseUnits)], errorCode: null }; }

test('sync coordinator atomically persists successful positions and status, with single-flight', async () => {
  let calls = 0;
  const pending = adapter({ ...success('7') }, 5);
  pending.scan = async (...args) => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return success('7'); };
  const coordinator = createSyncCoordinator({ adapters: [pending], ids: { next: (() => { let n = 0; return () => `position-${++n}`; })() }, now: () => 10, maxConcurrency: 1 });
  const initial = state();
  const first = coordinator.run(initial, {});
  const duplicate = coordinator.run(initial, {});
  assert.equal(first, duplicate);
  const run = await first;
  assert.equal(calls, 1);
  assert.equal(run.state.positions[0].baseUnits, '7');
  assert.equal(run.state.positions[0].quantity, '0.000000000000000007');
  assert.equal(run.state.sync.statuses[0].lastSuccessAt, 10);
  assert.equal(coordinator.active(), 0);
  const fraction = reconcileSync(initial, initial.wallets[0], { ...success('100'), positions: [{ ...draft('100'), assetName: 'Named asset', decimals: 2 }] }, 11, { next: () => 'fraction-position' });
  assert.equal(fraction.positions[0].quantity, '1');
  assert.equal(fraction.positions[0].assetName, 'Named asset');
});

test('wallet reconciliation preserves schema v5 quotes and chart history across minute syncs', () => {
  const initial = state();
  const history = [{ id: 'portfolio', kind: 'portfolio-value', points: [{ timestamp: 1, valueEurScaled: '100', valueUsdScaled: '110', coverage: 'complete' }] }];
  const priced = parsePortfolioState({ ...initial, prices: { ...initial.prices, history, totalEurScaled: '100', totalUsdScaled: '110' } });
  const reconciled = reconcileSync(priced, priced.wallets[0], success('7'), 2, { next: () => 'history-position' });
  assert.equal(reconciled.schemaVersion, 5);
  assert.deepEqual(reconciled.prices.history, history);
  assert.equal(reconciled.prices.totalEurScaled, '100');
  assert.equal(reconciled.prices.totalUsdScaled, '110');
});

test('provider disabled, unsupported, and error results preserve old positions and expose stable status', async () => {
  const initial = state();
  const seeded = reconcileSync(initial, initial.wallets[0], success('9'), 4, { next: () => 'seed-position' });
  const disabled = createSyncCoordinator({ adapters: [adapter(success('1'))], ids: { next: () => 'unused' }, now: () => 5 });
  const disabledRun = await disabled.run(parsePortfolioState({ ...seeded, settings: { ...seeded.settings, enabledProviderIds: [] } }), {});
  assert.equal(disabledRun.state.positions[0].baseUnits, '9');
  assert.equal(disabledRun.state.sync.statuses[0].status, 'unconfigured');
  const failedResult = { family: 'evm', providerId: 'evm', status: 'rate-limited', capability: 'native-complete', positions: [], errorCode: 'rate-limited' };
  const failed = createSyncCoordinator({ adapters: [adapter(failedResult)], ids: { next: () => 'unused' }, now: () => 8 });
  const failedRun = await failed.run(seeded, {});
  assert.equal(failedRun.state.positions[0].baseUnits, '9');
  assert.equal(failedRun.state.sync.statuses[0].lastSuccessAt, 4);
  assert.equal(failedRun.state.sync.statuses[0].status, 'rate-limited');
  const successfulReplacement = reconcileSync(seeded, seeded.wallets[0], success('9'), 6, { next: () => 'same-position' });
  assert.equal(successfulReplacement.positions[0].baseUnits, '9');
});

test('partial results replace returned assets while retaining unreturned known assets, and adapter factory is used', async () => {
  const initial = state();
  const extra = { ...draft('3'), assetKind: 'fungible', assetId: 'token', symbol: 'SYN', decimals: 2 };
  let seedId = 0;
  const seeded = reconcileSync(initial, initial.wallets[0], { ...success('10'), positions: [draft('10'), extra] }, 1, { next: () => `seed-${++seedId}` });
  const partial = { family: 'evm', providerId: 'evm', status: 'partial', capability: 'native-complete', positions: [draft('11')], errorCode: 'token-provider-error' };
  let factoryCalls = 0;
  const coordinator = createSyncCoordinator({ adapters: [], adapterFactory: () => { factoryCalls++; return [adapter(partial)]; }, ids: { next: () => 'next-position' }, now: () => 12 });
  const run = await coordinator.run(seeded, {});
  assert.equal(factoryCalls, 1);
  assert.equal(run.state.positions.find(item => item.assetId === 'native:1').baseUnits, '11');
  assert.equal(run.state.positions.find(item => item.assetId === 'token').baseUnits, '3');
  assert.equal(run.state.sync.statuses[0].status, 'partial');
  const stopped = createSyncCoordinator({ adapters: [], ids: { next: () => 'unused' }, now: () => 1 });
  stopped.stop();
  await assert.rejects(stopped.run(initial, {}), /stopped/);
});

test('disabled wallet is not scanned and malformed persisted sync statuses are discarded', async () => {
  const disabledState = parsePortfolioState({ ...state(), wallets: [{ ...state().wallets[0], enabled: false }], sync: { schemaVersion: 1, statuses: [{ walletId: 'missing', family: 'evm', providerId: 'evm', status: 'ok', lastAttemptAt: 1, lastSuccessAt: 1, errorCode: null }] } });
  const coordinator = createSyncCoordinator({ adapters: [adapter(success())], ids: { next: () => 'unused' }, now: () => 2 });
  const run = await coordinator.run(disabledState, {});
  assert.deepEqual(run.results, []);
  assert.deepEqual(run.state.sync.statuses, []);
  assert.equal(reconcileSync(disabledState, disabledState.wallets[0], { family: 'evm', providerId: 'evm', status: 'unsupported', capability: 'token-discovery-unavailable', positions: [], errorCode: 'unsupported' }, 2, { next: () => 'unused' }).sync.statuses[0].status, 'unsupported');
});

test('sync quantity formatting covers integer decimals and missing adapters', async () => {
  const integerDraft = { ...draft('10'), decimals: 0 };
  const integerState = reconcileSync(state(), state().wallets[0], { ...success('10'), positions: [integerDraft] }, 1, { next: () => 'integer-position' });
  assert.equal(integerState.positions[0].quantity, '10');
  const missing = createSyncCoordinator({ adapters: [], ids: { next: () => 'unused' }, now: () => 2 });
  const missingRun = await missing.run(state(), {});
  assert.equal(missingRun.results[0].status, 'unconfigured');
  const bitcoinAddress = encodeBase58Check(new Uint8Array([0, ...new Uint8Array(20).fill(5)]));
  const bitcoinState = parsePortfolioState({ schemaVersion: 3, wallets: [{ id: 'wallet-btc', label: 'Synthetic BTC', family: 'bitcoin', address: bitcoinAddress, enabled: true, createdAt: 1, options: { network: 'mainnet', addressType: 'address' } }], positions: [{ schemaVersion: 3, id: 'btc-position', walletId: 'wallet-btc', family: 'bitcoin', chainId: null, assetKind: 'native', assetId: 'native:btc', symbol: 'BTC', baseUnits: '2', quantity: '0.00000002', decimals: 8, confirmedBaseUnits: '2', pendingBaseUnits: '0', updatedAt: 1, spam: null }], settings: { enabledProviderIds: ['bitcoin.mempool'] } });
  const nullChain = reconcileSync(bitcoinState, bitcoinState.wallets[0], { family: 'bitcoin', providerId: 'bitcoin.mempool', status: 'partial', capability: 'native-complete', positions: [{ family: 'bitcoin', chainId: null, assetKind: 'native', assetId: 'native:btc', symbol: 'BTC', baseUnits: '3', decimals: 8 }], errorCode: 'partial' }, 2, { next: () => 'btc-next' });
  assert.equal(nullChain.positions[0].baseUnits, '3');
});

test('sync limiter rejects queued work when stopped', async () => {
  const secondWallet = { ...state().wallets[0], id: 'wallet-sync-2', address: `0x${'2'.repeat(40)}` };
  const twoWallets = parsePortfolioState({ ...state(), wallets: [...state().wallets, secondWallet] });
  let release;
  const first = adapter(success('1'));
  first.scan = async () => new Promise(resolve => { release = resolve; });
  const coordinator = createSyncCoordinator({ adapters: [first], ids: { next: () => 'unused' }, now: () => 2, maxConcurrency: 0 });
  const running = coordinator.run(twoWallets, {});
  await Promise.resolve();
  coordinator.stop();
  release(success('1'));
  await assert.rejects(running, /stopped/);
});

test('sync results and reconciled positions keep wallet order despite completion order', async () => {
  const secondWallet = { ...state().wallets[0], id: 'wallet-sync-2', address: `0x${'2'.repeat(40)}` };
  const orderedState = parsePortfolioState({ ...state(), wallets: [...state().wallets, secondWallet] });
  const adapterWithDelays = { family: 'evm', providerId: 'evm', async scan(wallet) {
    if (wallet.id === 'wallet-sync') await new Promise(resolve => setTimeout(resolve, 5));
    return success(wallet.id === 'wallet-sync' ? '1' : '2');
  } };
  const coordinator = createSyncCoordinator({ adapters: [adapterWithDelays], ids: { next: (() => { let count = 0; return () => `ordered-${++count}`; })() }, now: () => 3, maxConcurrency: 2 });
  const run = await coordinator.run(orderedState, {});
  assert.deepEqual(run.results.map(result => result.positions[0].baseUnits), ['1', '2']);
  assert.deepEqual(run.state.positions.map(position => position.baseUnits), ['1', '2']);
});

test('sync converts adapter exceptions into structured failures and aborts active signals on stop', async () => {
  let observed;
  const throwing = { family: 'evm', providerId: 'evm', async scan(_wallet, context) { observed = context.signal?.aborted; throw new Error('provider detail'); } };
  const coordinator = createSyncCoordinator({ adapters: [throwing], ids: { next: () => 'throwing-position' }, now: () => 4 });
  const run = await coordinator.run(state(), {});
  assert.equal(run.results[0].status, 'error');
  assert.equal(run.results[0].errorCode, 'scan-failed');
  assert.equal(observed, false);
  const pending = { family: 'evm', providerId: 'evm', async scan(_wallet, context) { await new Promise(resolve => { context.signal?.addEventListener('abort', resolve, { once: true }); }); return success('1'); } };
  const stopping = createSyncCoordinator({ adapters: [pending], ids: { next: () => 'stop-position' }, now: () => 5 });
  const request = stopping.run(state(), {});
  await Promise.resolve();
  stopping.stop();
  await request;
  const stoppedAdapter = { family: 'evm', providerId: 'evm', async scan() { throw new Error('stopped'); } };
  const stoppedResult = await createSyncCoordinator({ adapters: [stoppedAdapter], ids: { next: () => 'stopped-position' }, now: () => 6 }).run(state(), {});
  assert.equal(stoppedResult.results[0].status, 'aborted');
  const caller = new AbortController();
  const signalCoordinator = createSyncCoordinator({ adapters: [adapter(success('2'))], ids: { next: () => 'signal-position' }, now: () => 7 });
  const signalContext = { signal: caller.signal };
  await signalCoordinator.run(state(), signalContext);
  await signalCoordinator.run(state(), signalContext);
  caller.abort();
});

test('sync pricing stage is optional and contains pricing failures without losing wallet state', async () => {
  const base = { run: async () => { throw new Error('pricing-provider'); }, stop() {} };
  const contained = createSyncCoordinator({ adapters: [adapter(success('3'))], pricing: base, ids: { next: () => 'pricing-position' }, now: () => 8 });
  const result = await contained.run(state(), { http: { requestJson: async () => ({}) } });
  assert.equal(result.state.positions[0].baseUnits, '3');
  contained.stop();
  const stopped = createSyncCoordinator({ adapters: [adapter(success('4'))], pricing: { run: async () => { throw new Error('stopped'); }, stop() {} }, ids: { next: () => 'pricing-stopped' }, now: () => 9 });
  await assert.rejects(() => stopped.run(state(), { http: { requestJson: async () => ({}) } }), /stopped/);
});
