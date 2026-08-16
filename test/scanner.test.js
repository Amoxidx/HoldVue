import assert from 'node:assert/strict';
import test from 'node:test';
import { createJsonRpcPort, createRpcWorkLimiter, createScanCoordinator, createSingleFlight, formatUnits, parseHexQuantity, scanEvmNativeBalances, createCapabilityAdapter, unconfiguredCapability, unsupportedCapability, RpcError } from '../src/shared/scanner.ts';
import { TransportError } from '../src/shared/transport.ts';

function wallet(options = {}) { return { schemaVersion: 2, id: 'wallet-synthetic', label: 'Synthetic', family: 'evm', address: `0x${'1'.repeat(40)}`, enabled: true, createdAt: 1, options: { autoScanCommonChains: false, chainIds: [900001], ...options } }; }
function chain(overrides = {}) { return { family: 'evm', chainId: 900001, name: 'Synthetic', nativeAsset: 'SYN', nativeDecimals: 18, rpcUrl: 'https://rpc.synthetic.invalid', explorerBaseUrl: 'https://explorer.synthetic.invalid', capabilities: { nativeBalance: true, erc20Enumeration: 'unsupported', tokenMetadata: 'unsupported' }, builtin: false, ...overrides }; }

test('JSON-RPC port validates JSON-RPC envelopes and increments request ids', async () => {
  const requests = [];
  const rpc = createJsonRpcPort({ requestJson: async request => { requests.push(request); return { jsonrpc: '2.0', id: request.body.id, result: '0x1' }; } });
  assert.equal(await rpc.call('https://rpc.synthetic.invalid', 'eth_chainId', []), '0x1');
  assert.equal(await rpc.call('https://rpc.synthetic.invalid', 'eth_chainId', []), '0x1');
  assert.equal(requests[0].body.id, 1);
  assert.equal(requests[1].body.id, 2);
  const failing = createJsonRpcPort({ requestJson: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -1 } }) });
  await assert.rejects(failing.call('https://rpc.synthetic.invalid', 'bad', []), error => error.name === 'RpcError');
  const missing = createJsonRpcPort({ requestJson: async () => ({ jsonrpc: '1.0', id: 1 }) });
  await assert.rejects(missing.call('https://rpc.synthetic.invalid', 'bad', []), error => error.name === 'RpcError');
  const mismatched = createJsonRpcPort({ requestJson: async () => ({ jsonrpc: '2.0', id: 999, result: '0x1' }) });
  await assert.rejects(mismatched.call('https://rpc.synthetic.invalid', 'bad', []), error => error.name === 'RpcError');
});

test('hex quantities and exact native unit formatting are deterministic', () => {
  assert.equal(parseHexQuantity('0x0'), 0n);
  assert.equal(parseHexQuantity('0xde0b6b3a7640000'), 1000000000000000000n);
  assert.equal(parseHexQuantity('0x01'), null);
  assert.equal(parseHexQuantity('nope'), null);
  assert.equal(formatUnits(0n, 18), '0');
  assert.equal(formatUnits(42n, 0), '42');
  assert.equal(formatUnits(1000000000000000000n, 18), '1');
  assert.equal(formatUnits(1234500n, 4), '123.45');
  assert.throws(() => formatUnits(1n, -1), RangeError);
  assert.throws(() => formatUnits(1n, 37), RangeError);
});

test('EVM native scanner reports configured, unconfigured and per-chain errors', async () => {
  const configured = chain({ rpcUrl: 'https://rpc.synthetic.invalid/one' });
  const absent = chain({ chainId: 900002, name: 'Absent', rpcUrl: null });
  const invalid = chain({ chainId: 900003, name: 'Invalid', rpcUrl: 'https://rpc.synthetic.invalid/three' });
  const failing = chain({ chainId: 900004, name: 'Failing', rpcUrl: 'https://rpc.synthetic.invalid/four' });
  const calls = [];
  const rpc = { call: async (url, method, params) => { calls.push([method, params]); const chainId = url.endsWith('/one') ? 900001 : url.endsWith('/three') ? 900003 : 900004; if (method === 'eth_chainId') return `0x${chainId.toString(16)}`; if (params[0] === 'invalid') return '0x01'; if (params[0] === 'fail') throw new Error('synthetic'); return '0xde0b6b3a7640000'; } };
  const results = await scanEvmNativeBalances({ ...wallet({ chainIds: [900001, 900002, 900003, 900004] }), address: `0x${'1'.repeat(40)}` }, [configured, absent, invalid, failing], rpc);
  assert.equal(results.length, 4);
  assert.equal(results[0].status, 'ok');
  assert.equal(results[0].quantity, '1');
  assert.equal(results[1].status, 'unconfigured');
  assert.equal(results[2].status, 'ok');
  assert.equal(results[3].status, 'ok');
  assert.equal(calls.length, 6);
  const malformed = await scanEvmNativeBalances({ ...wallet(), address: 'invalid' }, [configured], { call: async (_url, method) => method === 'eth_chainId' ? '0xDBBA1' : '0x01' });
  assert.equal(malformed[0].status, 'error');
  assert.equal(malformed[0].errorCode, 'invalid-quantity');
  const rpcFailure = await scanEvmNativeBalances(wallet(), [configured], { call: async () => { throw new RpcError(); } });
  assert.equal(rpcFailure[0].errorCode, 'rpc');
  const transportFailure = await scanEvmNativeBalances(wallet(), [configured], { call: async () => { throw new TransportError('timeout', 'synthetic'); } });
  assert.equal(transportFailure[0].errorCode, 'timeout');
  const unknownFailure = await scanEvmNativeBalances(wallet(), [configured], { call: async () => { throw new Error('synthetic'); } });
  assert.equal(unknownFailure[0].errorCode, 'unknown');
  const mismatch = await scanEvmNativeBalances(wallet(), [configured], { call: async (_url, method) => method === 'eth_chainId' ? '0x1' : '0xde0b6b3a7640000' });
  assert.equal(mismatch[0].errorCode, 'chain-mismatch');
  const disabled = await scanEvmNativeBalances({ ...wallet(), enabled: false }, [configured], rpc);
  assert.deepEqual(disabled, []);
  const filtered = await scanEvmNativeBalances({ ...wallet({ chainIds: [900001, 900002] }), address: `0x${'1'.repeat(40)}` }, [configured, absent], rpc, undefined, { enabledChainIds: [900002] });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].chainId, 900002);
  const builtin = await scanEvmNativeBalances({ ...wallet(), options: { autoScanCommonChains: true, chainIds: [] } }, [chain({ chainId: 1, builtin: true, rpcUrl: null })], rpc);
  assert.equal(builtin[0].status, 'unconfigured');
  const none = await scanEvmNativeBalances(wallet({ autoScanCommonChains: false, chainIds: [] }), [configured], rpc);
  assert.deepEqual(none, []);
});

test('native scanner uses the selected chain native decimals', async () => {
  const six = chain({ chainId: 900006, nativeAsset: 'SIX', nativeDecimals: 6, rpcUrl: 'https://rpc.synthetic.invalid/six' });
  const eight = chain({ chainId: 900008, nativeAsset: 'EIGHT', nativeDecimals: 8, rpcUrl: 'https://rpc.synthetic.invalid/eight' });
  const rpc = { call: async (url, method) => method === 'eth_chainId' ? `0x${(url.endsWith('six') ? 900006 : 900008).toString(16)}` : url.endsWith('six') ? '0x1e240' : '0x5f5e100' };
  const results = await scanEvmNativeBalances(wallet({ chainIds: [900006, 900008] }), [six, eight], rpc);
  assert.deepEqual(results.map(result => [result.chainId, result.decimals, result.quantity]), [[900006, 6, '0.123456'], [900008, 8, '1']]);
});

test('scan coordinator deduplicates identical configs and globally limits RPC chain work', async () => {
  const configured = chain({ rpcUrl: 'https://rpc.synthetic.invalid/one' });
  let active = 0; let maximum = 0; let calls = 0;
  const rpc = { call: async (_url, method) => { active++; maximum = Math.max(maximum, active); calls++; await new Promise(resolve => setTimeout(resolve, 1)); active--; return method === 'eth_chainId' ? '0xdbba1' : '0x0'; } };
  const coordinator = createScanCoordinator(1);
  const first = coordinator.scan(wallet(), [configured], rpc);
  const duplicate = coordinator.scan(wallet(), [configured], rpc);
  assert.equal(first, duplicate);
  const second = coordinator.scan({ ...wallet(), id: 'wallet-two' }, [configured], rpc);
  await Promise.all([first, duplicate, second]);
  assert.equal(maximum, 1);
  assert.equal(calls, 4);
  assert.equal(coordinator.active(), 0);
  const configuredBySettings = await coordinator.scan(wallet(), [configured], rpc, undefined, { enabledChainIds: [900001] });
  assert.equal(configuredBySettings[0].status, 'ok');
  const builtinBySettings = await coordinator.scan({ ...wallet({ autoScanCommonChains: true, chainIds: [] }), id: 'wallet-built-in' }, [chain({ chainId: 1, builtin: true, rpcUrl: null })], rpc, undefined, { enabledChainIds: [1] });
  assert.equal(builtinBySettings[0].status, 'unconfigured');
  const excludedBySettings = await coordinator.scan({ ...wallet({ autoScanCommonChains: false, chainIds: [] }), id: 'wallet-excluded' }, [configured], rpc, undefined, { enabledChainIds: [900001] });
  assert.deepEqual(excludedBySettings, []);
});

test('scan coordinator limits multiple chains across wallets and does not dedupe differing effective configs', async () => {
  const first = chain({ chainId: 900001, rpcUrl: 'https://rpc.synthetic.invalid/one' });
  const second = chain({ chainId: 900002, rpcUrl: 'https://rpc.synthetic.invalid/two' });
  const third = chain({ chainId: 900003, rpcUrl: 'https://rpc.synthetic.invalid/three' });
  let active = 0; let maximum = 0; const calls = [];
  const rpc = { call: async (url, method) => { active++; maximum = Math.max(maximum, active); calls.push([url, method]); await new Promise(resolve => setTimeout(resolve, 2)); active--; return method === 'eth_chainId' ? `0x${({ one: 900001, two: 900002, three: 900003, other: 900001 }[url.split('/').pop()]).toString(16)}` : '0x0'; } };
  const coordinator = createScanCoordinator(2);
  const walletOne = wallet({ chainIds: [900001, 900002] });
  const walletTwo = { ...wallet({ chainIds: [900003] }), id: 'wallet-two' };
  const firstRequest = coordinator.scan(walletOne, [first, second], rpc);
  const differentChains = coordinator.scan(walletOne, [first, third], rpc);
  const differentRpc = coordinator.scan(walletOne, [{ ...first, rpcUrl: 'https://rpc.synthetic.invalid/other' }, second], rpc);
  assert.notEqual(firstRequest, differentChains);
  assert.notEqual(firstRequest, differentRpc);
  const [one, two, changed, three] = await Promise.all([firstRequest, differentChains, differentRpc, coordinator.scan(walletTwo, [third], rpc)]);
  assert.deepEqual(one.map(result => result.chainId), [900001, 900002]);
  assert.deepEqual(two.map(result => result.chainId), [900001]);
  assert.deepEqual(changed.map(result => result.chainId), [900001, 900002]);
  assert.deepEqual(three.map(result => result.chainId), [900003]);
  assert.equal(maximum <= 2, true);
  assert.equal(coordinator.active(), 0);
  assert.equal(calls.length, 12);
});

test('scan coordinator isolates RPC port and AbortSignal identities', async () => {
  const configured = chain({ rpcUrl: 'https://rpc.synthetic.invalid/identity' });
  const calls = [];
  const makeRpc = tag => ({ call: async (_url, method) => { calls.push([tag, method]); return method === 'eth_chainId' ? '0xdbba1' : '0x0'; } });
  const firstRpc = makeRpc('first');
  const secondRpc = makeRpc('second');
  const coordinator = createScanCoordinator(2);
  const first = coordinator.scan(wallet(), [configured], firstRpc);
  const second = coordinator.scan(wallet(), [configured], secondRpc);
  assert.notEqual(first, second);
  await Promise.all([first, second]);
  assert.deepEqual(calls.map(item => item[0]).sort(), ['first', 'first', 'second', 'second']);
  calls.length = 0;
  const signalOne = new AbortController();
  const signalTwo = new AbortController();
  const withFirstSignal = coordinator.scan(wallet({ chainIds: [900001] }), [configured], firstRpc, signalOne.signal);
  const withSecondSignal = coordinator.scan(wallet({ chainIds: [900001] }), [configured], firstRpc, signalTwo.signal);
  assert.notEqual(withFirstSignal, withSecondSignal);
  await Promise.all([withFirstSignal, withSecondSignal]);
  assert.equal(calls.length, 4);
});

test('queued scan aborts before any RPC work starts', async () => {
  const first = chain({ rpcUrl: 'https://rpc.synthetic.invalid/first' });
  const second = chain({ chainId: 900002, rpcUrl: 'https://rpc.synthetic.invalid/second' });
  let release;
  let firstStarted = false;
  const calls = [];
  const rpc = { call: async (url, method) => {
    calls.push([url, method]);
    if (url.endsWith('/first') && method === 'eth_chainId') {
      firstStarted = true;
      await new Promise(resolve => { release = resolve; });
    }
    return url.endsWith('/first') ? '0xdbba1' : '0xdbba2';
  } };
  const coordinator = createScanCoordinator(1);
  const firstRequest = coordinator.scan(wallet(), [first], rpc);
  while (!firstStarted) await new Promise(resolve => setImmediate(resolve));
  const controller = new AbortController();
  const queued = coordinator.scan({ ...wallet({ chainIds: [900002] }), id: 'wallet-two' }, [second], rpc, controller.signal);
  controller.abort();
  release();
  const [firstResult, queuedResult] = await Promise.all([firstRequest, queued]);
  assert.equal(firstResult[0].status, 'ok');
  assert.equal(queuedResult[0].status, 'error');
  assert.equal(queuedResult[0].errorCode, 'aborted');
  assert.deepEqual(calls.map(call => call[0]), ['https://rpc.synthetic.invalid/first', 'https://rpc.synthetic.invalid/first']);
});

test('RPC limiter handles pre-start aborts, signal races and safe defaults', async () => {
  const limiter = createRpcWorkLimiter(1);
  let release;
  const running = limiter.run(() => new Promise(resolve => { release = resolve; }));
  while (typeof release !== 'function') await Promise.resolve();
  const fakeSignal = { aborted: false, addEventListener: () => {}, removeEventListener: () => {} };
  const queued = limiter.run(async () => 'must-not-run', fakeSignal);
  fakeSignal.aborted = true;
  release('done');
  assert.equal(await running, 'done');
  await assert.rejects(queued, error => error instanceof TransportError && error.code === 'aborted');
  assert.equal(limiter.active(), 0);
  const startedController = new AbortController();
  assert.equal(await limiter.run(async () => 'started', startedController.signal), 'started');
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(limiter.run(async () => 'must-not-run', alreadyAborted.signal), error => error instanceof TransportError && error.code === 'aborted');
  assert.equal(createRpcWorkLimiter(0).active(), 0);
});

test('RPC limiter ignores aborts after a task starts and repeated queued abort callbacks', async () => {
  const limiter = createRpcWorkLimiter(1);
  let release;
  const activeController = new AbortController();
  const active = limiter.run(() => new Promise(resolve => { release = resolve; }), activeController.signal);
  while (typeof release !== 'function') await Promise.resolve();
  activeController.abort();
  release('active');
  assert.equal(await active, 'active');
  let callback;
  const signal = { aborted: false, addEventListener: (_type, listener) => { callback = listener; }, removeEventListener: () => {} };
  const queued = limiter.run(async () => 'must-not-run', signal);
  callback();
  callback();
  await assert.rejects(queued, error => error instanceof TransportError && error.code === 'aborted');
});

test('capability ports are explicit unsupported or unconfigured and never include NFTs', async () => {
  assert.deepEqual(unsupportedCapability('erc20').includesNfts, false);
  assert.equal(unconfiguredCapability('bitcoin').status, 'unconfigured');
  assert.equal((await createCapabilityAdapter('solana').scan()).status, 'unconfigured');
  const configured = createCapabilityAdapter('cardano', { scan: async () => ({ capability: 'cardano', status: 'unsupported', reason: 'synthetic', includesNfts: false }) });
  assert.equal((await configured.scan()).includesNfts, false);
});

test('single-flight deduplicates keys and enforces a concurrency limit', async () => {
  const flight = createSingleFlight(1);
  let executions = 0;
  let release;
  const firstTask = () => new Promise(resolve => { release = resolve; executions++; });
  const first = flight.run('same', firstTask);
  const duplicate = flight.run('same', async () => { executions += 10; return 'wrong'; });
  assert.equal(first, duplicate);
  assert.equal(flight.active(), 1);
  const second = flight.run('second', async () => { executions++; return 'second'; });
  assert.equal(flight.active(), 1);
  await Promise.resolve();
  release('first');
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
  assert.equal(executions, 2);
  await Promise.resolve();
  assert.equal(flight.active(), 0);
  assert.equal(await flight.run('reject', async () => { throw new Error('synthetic'); }).catch(error => error.message), 'synthetic');
  assert.equal(await flight.run('sync-reject', () => { throw new Error('sync-synthetic'); }).catch(error => error.message), 'sync-synthetic');
  assert.equal(createSingleFlight(0).active(), 0);
});
