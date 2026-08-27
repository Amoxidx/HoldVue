import assert from 'node:assert/strict';
import test from 'node:test';
import { COINGECKO_TOKEN_CATALOG_URL, createCoinGeckoEvmTokenDiscovery, parseCoinGeckoTokenCatalog } from '../src/shared/evm-token-discovery.ts';
import { TransportError } from '../src/shared/transport.ts';

const address = `0x${'1'.repeat(40)}`;
const contractA = `0x${'a'.repeat(40)}`;
const contractB = `0x${'b'.repeat(40)}`;
const chain = (overrides = {}) => ({ family: 'evm', chainId: 8453, name: 'Base', nativeAsset: 'ETH', nativeDecimals: 18, rpcUrl: 'https://base-rpc.synthetic.invalid', explorerBaseUrl: 'https://basescan.org', capabilities: { nativeBalance: true, erc20Enumeration: 'unsupported', tokenMetadata: 'unsupported' }, builtin: true, ...overrides });
const wallet = (overrides = {}) => ({ schemaVersion: 3, id: 'wallet', label: 'Wallet', family: 'evm', address, enabled: true, createdAt: 1, options: { autoScanCommonChains: false, chainIds: [8453] }, ...overrides });
const catalog = () => [
  { id: 'alpha', symbol: 'aaa', name: 'Alpha', platforms: { base: contractA } },
  { id: 'beta', symbol: 'bbb', name: 'Beta', platforms: { base: contractB } }
];

function responseFor(request, balances = { [contractA]: 42n, [contractB]: 0n }, decimals = { [contractA]: 6n, [contractB]: 18n }) {
  if (request.url === COINGECKO_TOKEN_CATALOG_URL) return catalog();
  return request.body.map(item => {
    const contract = item.params[0].to.toLowerCase();
    const selector = item.params[0].data.slice(0, 10);
    const value = selector === '0x70a08231' ? balances[contract] ?? 0n : decimals[contract] ?? 18n;
    return { jsonrpc: '2.0', id: item.id, result: `0x${value.toString(16)}` };
  });
}

test('CoinGecko token catalog parsing is strict, bounded and deterministic', () => {
  assert.throws(() => parseCoinGeckoTokenCatalog({}, [8453]), /invalid-catalog/);
  const parsed = parseCoinGeckoTokenCatalog([
    null,
    { symbol: 'skip', name: 'Skip' },
    { symbol: '', name: 'Skip', platforms: { base: contractA } },
    { symbol: 'bad\u0000', name: 'Skip', platforms: { base: contractA } },
    { symbol: 'x'.repeat(41), name: 'Skip', platforms: { base: contractA } },
    { symbol: 'BAD', name: '', platforms: { base: contractA } },
    { symbol: 'BAD', name: 'x'.repeat(161), platforms: { base: contractA } },
    { symbol: 'BAD', name: 'Bad contract', platforms: { base: '0x1234' } },
    { symbol: 'AAA', name: 'Alpha', platforms: { base: contractA } },
    { symbol: 'DUP', name: 'Duplicate', platforms: { base: contractA.toUpperCase().replace('0X', '0x') } },
    { symbol: 'ETH', name: 'Ethereum token', platforms: { ethereum: contractB } }
  ], [8453, 1, 999999]);
  assert.deepEqual(parsed, [
    { chainId: 8453, contract: contractA, symbol: 'AAA', name: 'Alpha' },
    { chainId: 1, contract: contractB, symbol: 'ETH', name: 'Ethereum token' }
  ]);
});

test('keyless discovery scans balances on-chain, reads decimals, caches positives and refreshes catalogs', async () => {
  let clock = 100;
  const calls = [];
  let alphaBalance = 42n;
  const http = { async requestJson(request) { calls.push(request); return responseFor(request, { [contractA]: alphaBalance, [contractB]: 0n }); } };
  const discovery = createCoinGeckoEvmTokenDiscovery({ http, now: () => clock, catalogTtlMs: 10, fullScanTtlMs: 5, batchSize: 2, batchSizesByChainId: { 8453: 1 }, concurrency: 1, maxCatalogBytes: 4_000_000, rpcAttempts: 2, rpcTimeoutMs: 5_000 });
  const first = await discovery.scan(wallet(), [chain()], { now: clock, settings: { enabledChainIds: [] } });
  assert.equal(first.status, 'partial');
  assert.equal(first.errorCode, 'catalog-coverage');
  assert.deepEqual(first.positions.map(item => [item.symbol, item.assetName, item.baseUnits, item.decimals, item.spam.hiddenByDefault]), [['AAA', 'Alpha', '42', 6, false]]);
  assert.equal(calls[0].maxBytes, 4_000_000);
  assert.equal(calls.find(call => call.url !== COINGECKO_TOKEN_CATALOG_URL).timeoutMs, 5_000);
  assert.equal(calls.filter(call => call.url === COINGECKO_TOKEN_CATALOG_URL).length, 1);
  alphaBalance = 43n;
  clock = 102;
  const cached = await discovery.scan(wallet(), [chain()], { now: clock });
  assert.equal(cached.positions[0].baseUnits, '43');
  assert.equal(calls.at(-2).body.length, 1);
  clock = 120;
  await discovery.scan(wallet(), [chain()], { now: clock });
  assert.equal(calls.filter(call => call.url === COINGECKO_TOKEN_CATALOG_URL).length, 2);
});

test('keyless discovery bounds catalog work, rotates coverage and prioritizes previously known holdings', async () => {
  const calls = [];
  const http = { async requestJson(request) { calls.push(request); return responseFor(request, { [contractA]: 42n, [contractB]: 1n }); } };
  const discovery = createCoinGeckoEvmTokenDiscovery({ http, catalogScanLimitPerChain: 1, batchSize: 1, wait: async () => undefined });
  const first = await discovery.scan(wallet(), [chain()], { now: 1 });
  assert.deepEqual(first.positions.map(item => item.symbol), ['AAA']);
  const second = await discovery.scan(wallet(), [chain()], { now: 2 });
  assert.deepEqual(second.positions.map(item => item.symbol).sort(), ['AAA', 'BBB']);
  assert.equal(calls.filter(call => call.url !== COINGECKO_TOKEN_CATALOG_URL && call.body[0].params[0].data.startsWith('0x70a08231')).length, 3);

  const knownFirst = createCoinGeckoEvmTokenDiscovery({ http, catalogScanLimitPerChain: 1, batchSize: 2, wait: async () => undefined });
  const known = await knownFirst.scan(wallet(), [chain()], { now: 3, positions: [{ schemaVersion: 3, id: 'known', walletId: 'wallet', family: 'evm', chainId: 8453, assetKind: 'fungible', assetId: contractB, symbol: 'BBB', baseUnits: '1', quantity: '0.000000000000000001', confirmedBaseUnits: '1', pendingBaseUnits: '0', decimals: 18, updatedAt: 1, spam: null }] });
  assert.deepEqual(known.positions.map(item => item.symbol).sort(), ['AAA', 'BBB']);

  const rotating = createCoinGeckoEvmTokenDiscovery({ http: { requestJson: async request => responseFor(request, { [contractA]: 0n, [contractB]: 1n }) }, catalogScanLimitPerChain: 1, wait: async () => undefined });
  assert.deepEqual((await rotating.scan(wallet(), [chain()], { now: 4 })).positions, []);
  assert.deepEqual((await rotating.scan(wallet(), [chain()], { now: 5 })).positions.map(item => item.symbol), ['BBB']);
});

test('discovery handles selection, malformed RPC rows, bad decimals and empty catalogs', async () => {
  const noChain = createCoinGeckoEvmTokenDiscovery({ http: { requestJson: async () => catalog() }, wait: async () => undefined });
  assert.equal((await noChain.scan(wallet(), [chain({ rpcUrl: null })], { now: 1 })).errorCode, 'no-enabled-chain');
  assert.equal((await noChain.scan(wallet(), [chain()], { now: 1, settings: { enabledChainIds: [1] } })).errorCode, 'no-enabled-chain');
  const autoWallet = wallet({ options: { autoScanCommonChains: true, chainIds: [] } });
  assert.equal((await noChain.scan(autoWallet, [chain()], { now: 1, settings: { enabledChainIds: [8453] } })).status, 'partial');
  assert.equal((await noChain.scan(autoWallet, [chain({ builtin: false })], { now: 1 })).errorCode, 'no-enabled-chain');

  const malformed = createCoinGeckoEvmTokenDiscovery({ http: { async requestJson(request) {
    if (request.url === COINGECKO_TOKEN_CATALOG_URL) return catalog();
    if (request.body[0].params[0].data.startsWith('0x70a08231')) return [null, { id: 'bad', result: '0x1' }, { id: 1, error: {} }, { id: 2, result: '0x01' }];
    return [];
  } }, batchSize: 2 });
  assert.deepEqual((await malformed.scan(wallet(), [chain()], { now: 1 })).positions, []);

  const nonArrayRpc = createCoinGeckoEvmTokenDiscovery({ http: { requestJson: async request => request.url === COINGECKO_TOKEN_CATALOG_URL ? catalog() : {} }, rpcAttempts: 3, wait: async () => undefined });
  assert.deepEqual((await nonArrayRpc.scan(wallet(), [chain()], { now: 1 })).positions, []);

  const badDecimals = createCoinGeckoEvmTokenDiscovery({ http: { async requestJson(request) {
    if (request.url === COINGECKO_TOKEN_CATALOG_URL) return catalog();
    if (request.body[0].params[0].data.startsWith('0x70a08231')) return [{ id: 1, result: '0x1' }, { id: 2, result: 'bad' }];
    return [{ id: 1, result: '0x25' }];
  } }, batchSize: 2, batchSizesByChainId: { 8453: 999 }, concurrency: 99, catalogTtlMs: -1, fullScanTtlMs: 999_999_999, maxCatalogBytes: 99_999_999, rpcDelayMs: -1, rpcAttempts: 99, rpcTimeoutMs: 99_999 });
  assert.deepEqual((await badDecimals.scan(wallet(), [chain()], { now: 1 })).positions, []);

  const empty = createCoinGeckoEvmTokenDiscovery({ http: { requestJson: async request => request.url === COINGECKO_TOKEN_CATALOG_URL ? [] : (() => { throw new Error('unexpected'); })() }, batchSize: 0, rpcDelayMs: 6_000 });
  assert.deepEqual((await empty.scan(wallet(), [chain()], { now: 1 })).positions, []);
});

test('discovery deduplicates concurrent catalog work and maps transport failures without leaking details', async () => {
  let release;
  let catalogCalls = 0;
  const http = { async requestJson(request) {
    if (request.url === COINGECKO_TOKEN_CATALOG_URL) { catalogCalls++; await new Promise(resolve => { release = resolve; }); return []; }
    return [];
  } };
  const discovery = createCoinGeckoEvmTokenDiscovery({ http });
  const first = discovery.scan(wallet(), [chain()], { now: 1 });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const second = discovery.scan(wallet({ id: 'other', address: `0x${'2'.repeat(40)}` }), [chain()], { now: 1 });
  release();
  await Promise.all([first, second]);
  assert.equal(catalogCalls, 1);

  for (const [error, status, code] of [
    [new TransportError('aborted', 'hidden'), 'aborted', 'aborted'],
    [new TransportError('http', 'hidden', 429), 'rate-limited', 'rate-limited'],
    [new Error('hidden'), 'error', 'network']
  ]) {
    const failing = createCoinGeckoEvmTokenDiscovery({ http: { requestJson: async () => { throw error; } }, wait: async () => undefined });
    const result = await failing.scan(wallet(), [chain()], { now: 1 });
    assert.equal(result.status, status);
    assert.equal(result.errorCode, code);
  }
});

test('discovery retries bounded provider limits and its default wait remains abortable', async () => {
  let attempts = 0;
  const waits = [];
  const recovering = createCoinGeckoEvmTokenDiscovery({
    http: { async requestJson() { attempts++; if (attempts < 3) throw new TransportError('http', 'hidden', 500); return []; } },
    wait: async milliseconds => { waits.push(milliseconds); }
  });
  assert.equal((await recovering.scan(wallet(), [chain()], { now: 1 })).status, 'partial');
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [1_000, 2_000]);

  let defaultAttempts = 0;
  const defaultWait = createCoinGeckoEvmTokenDiscovery({ http: { async requestJson() { defaultAttempts++; if (defaultAttempts === 1) throw new TransportError('http', 'hidden', 429); return []; } } });
  assert.equal((await defaultWait.scan(wallet(), [chain()], { now: 1 })).status, 'partial');
  assert.equal(defaultAttempts, 2);

  const controller = new AbortController();
  const aborting = createCoinGeckoEvmTokenDiscovery({ http: { requestJson: async () => { throw new TransportError('http', 'hidden', 429); } } });
  const pending = aborting.scan(wallet(), [chain()], { now: 1, signal: controller.signal });
  setTimeout(() => controller.abort(), 1);
  const aborted = await pending;
  assert.equal(aborted.status, 'aborted');
});

test('discovery fails over incomplete or failed RPC batches to a second on-chain endpoint', async () => {
  const calls = [];
  const waits = [];
  const http = { async requestJson(request) {
    calls.push(request.url);
    if (request.url === COINGECKO_TOKEN_CATALOG_URL) return catalog();
    if (request.url === 'https://base-rpc.synthetic.invalid') {
      if (request.body[0].params[0].data.startsWith('0x70a08231')) return [{ id: 1, result: '0x2a' }];
      throw new TransportError('network', 'hidden');
    }
    return responseFor(request);
  } };
  const discovery = createCoinGeckoEvmTokenDiscovery({ http, rpcFallbacks: { 8453: ['https://base-fallback.synthetic.invalid'] }, rpcDelayMs: 1, wait: async milliseconds => { waits.push(milliseconds); } });
  const result = await discovery.scan(wallet(), [chain()], { now: 1 });
  assert.equal(result.positions[0].baseUnits, '42');
  assert.equal(calls.includes('https://base-fallback.synthetic.invalid'), true);
  assert.equal(waits.includes(1), true);

  const partial = createCoinGeckoEvmTokenDiscovery({ http: { async requestJson(request) {
    if (request.url === COINGECKO_TOKEN_CATALOG_URL) return catalog();
    if (request.url === 'https://also-partial.synthetic.invalid') return [];
    return [{ id: 1, result: request.body[0].params[0].data.startsWith('0x70a08231') ? '0x2a' : '0x6' }];
  } }, rpcFallbacks: { 8453: ['https://also-partial.synthetic.invalid'] }, rpcDelayMs: 1, wait: async () => undefined });
  assert.equal((await partial.scan(wallet(), [chain()], { now: 1 })).positions[0].baseUnits, '42');
});

test('discovery retains the last verified holdings when an on-chain refresh fails', async () => {
  let failRpc = false;
  let failCatalog = false;
  let clock = 1;
  const http = { async requestJson(request) {
    if (failCatalog || (failRpc && request.url !== COINGECKO_TOKEN_CATALOG_URL)) throw new TransportError('timeout', 'hidden');
    return responseFor(request);
  } };
  const discovery = createCoinGeckoEvmTokenDiscovery({ http, now: () => clock, fullScanTtlMs: 100, catalogTtlMs: 100, wait: async () => undefined });
  const first = await discovery.scan(wallet(), [chain()], { now: 1 });
  assert.equal(first.positions.length, 1);
  failRpc = true;
  clock = 2;
  const partial = await discovery.scan(wallet(), [chain()], { now: 2 });
  assert.equal(partial.errorCode, 'catalog-rpc-partial');
  assert.equal(partial.positions[0].baseUnits, '42');
  failCatalog = true;
  clock = 200;
  const stale = await discovery.scan(wallet(), [chain()], { now: 200 });
  assert.equal(stale.status, 'partial');
  assert.equal(stale.errorCode, 'stale-catalog');
  assert.equal(stale.positions[0].baseUnits, '42');
});

test('discovery isolates failed balance and decimal groups but still propagates cancellation', async () => {
  let mode = 'balance-error';
  const http = { async requestJson(request) {
    if (request.url === COINGECKO_TOKEN_CATALOG_URL) return catalog();
    const decimals = request.body[0].params[0].data.startsWith('0x313ce567');
    if (mode === 'balance-error' && !decimals) throw new TransportError('timeout', 'hidden');
    if (mode === 'decimal-error' && decimals) throw new TransportError('network', 'hidden');
    if (mode === 'decimal-partial' && decimals && request.body.length > 1) return [{ id: 1, result: '0x6' }];
    if (mode === 'partial-abort' && !decimals) {
      if (request.body.length > 1) return [];
      throw new TransportError('aborted', 'hidden');
    }
    if (mode === 'abort' || (mode === 'decimal-abort' && decimals)) throw new TransportError('aborted', 'hidden');
    return responseFor(request, { [contractA]: 42n, [contractB]: 1n });
  } };
  const failedBalances = createCoinGeckoEvmTokenDiscovery({ http, batchSize: 1, wait: async () => undefined });
  assert.equal((await failedBalances.scan(wallet(), [chain()], { now: 1 })).errorCode, 'catalog-rpc-partial');
  mode = 'decimal-error';
  const failedDecimals = createCoinGeckoEvmTokenDiscovery({ http, wait: async () => undefined });
  assert.equal((await failedDecimals.scan(wallet(), [chain()], { now: 1 })).positions.length, 0);
  mode = 'decimal-partial';
  const recoveredDecimals = createCoinGeckoEvmTokenDiscovery({ http, wait: async () => undefined });
  assert.equal((await recoveredDecimals.scan(wallet(), [chain()], { now: 1 })).positions.length, 2);
  mode = 'abort';
  const aborted = createCoinGeckoEvmTokenDiscovery({ http, wait: async () => undefined });
  assert.equal((await aborted.scan(wallet(), [chain()], { now: 1 })).status, 'aborted');
  mode = 'decimal-abort';
  const decimalAbort = createCoinGeckoEvmTokenDiscovery({ http, wait: async () => undefined });
  assert.equal((await decimalAbort.scan(wallet(), [chain()], { now: 1 })).status, 'aborted');
  mode = 'partial-abort';
  const partialAbort = createCoinGeckoEvmTokenDiscovery({ http, wait: async () => undefined });
  assert.equal((await partialAbort.scan(wallet(), [chain()], { now: 1 })).status, 'aborted');
});

test('discovery resumes a partial full scan at the first failed contract group', async () => {
  let clock = 1;
  let run = 1;
  const balanceCalls = [];
  const http = { async requestJson(request) {
    if (request.url === COINGECKO_TOKEN_CATALOG_URL) return catalog();
    const isBalance = request.body[0].params[0].data.startsWith('0x70a08231');
    const contractAddress = request.body[0].params[0].to.toLowerCase();
    if (isBalance) balanceCalls.push({ run, contractAddress });
    if (run === 1 && isBalance && contractAddress === contractB) throw new TransportError('timeout', 'hidden');
    return responseFor(request, { [contractA]: 42n, [contractB]: 1n });
  } };
  const discovery = createCoinGeckoEvmTokenDiscovery({ http, now: () => clock, batchSize: 1, fullScanTtlMs: 1, wait: async () => undefined });
  assert.equal((await discovery.scan(wallet(), [chain()], { now: clock })).errorCode, 'catalog-rpc-partial');
  run = 2;
  clock = 2;
  const resumed = await discovery.scan(wallet(), [chain()], { now: clock });
  assert.equal(balanceCalls.some(item => item.run === 2 && item.contractAddress === contractB), true);
  assert.deepEqual(resumed.positions.map(item => item.symbol).sort(), ['AAA', 'BBB']);
});

test('discovery globally bounds RPC batches across concurrent wallets', async () => {
  let active = 0;
  let maximum = 0;
  const http = { async requestJson(request) {
    if (request.url === COINGECKO_TOKEN_CATALOG_URL) return [catalog()[0]];
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return responseFor(request);
  } };
  const discovery = createCoinGeckoEvmTokenDiscovery({ http, concurrency: 2 });
  await Promise.all([
    discovery.scan(wallet(), [chain()], { now: 1 }),
    discovery.scan(wallet({ id: 'second', address: `0x${'2'.repeat(40)}` }), [chain()], { now: 1 })
  ]);
  assert.equal(maximum, 2);
});
