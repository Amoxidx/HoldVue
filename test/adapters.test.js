import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeBase58Check, encodeBech32 } from '../src/shared/addresses.ts';
import { createBitcoinAdapter, createCardanoAdapter, createEvmAdapter, createEtherscanRateLimiter, createSolanaAdapter, positionFromDraft } from '../src/shared/adapters.ts';
import { createJsonRpcPort } from '../src/shared/scanner.ts';
import { TransportError } from '../src/shared/transport.ts';

const evmAddress = `0x${'1'.repeat(40)}`;
const btcAddress = encodeBase58Check(new Uint8Array([0, ...new Uint8Array(20).fill(7)]));
const btcTestnet = encodeBase58Check(new Uint8Array([111, ...new Uint8Array(20).fill(8)]));
const solAddress = '1'.repeat(32);
const cardanoAddress = encodeBech32('addr', new Uint8Array([0x01, ...new Uint8Array(56).fill(4)]));
const stakeCardanoAddress = encodeBech32('stake', new Uint8Array([0xe1, ...new Uint8Array(28).fill(5)]));
const baseChain = { family: 'evm', chainId: 8453, name: 'Base', nativeAsset: 'ETH', nativeDecimals: 18, rpcUrl: null, explorerBaseUrl: 'https://basescan.org', capabilities: { nativeBalance: true, erc20Enumeration: 'unsupported', tokenMetadata: 'unsupported' }, builtin: true };

function wallet(family, address, options) {
  return { schemaVersion: 3, id: `wallet-${family}`, label: `Synthetic ${family}`, family, address, enabled: true, createdAt: 1, options };
}
function httpPort(response, error = null) {
  const calls = [];
  return { calls, async requestJson(request) { calls.push(request); if (error) throw error; return typeof response === 'function' ? response(request) : response; } };
}
function secretStore(value = 'synthetic-key') { return { get: () => ({ ok: true, value }), set: () => ({ ok: true, value: undefined }), delete: () => ({ ok: true, value: undefined }) }; }
function rpcPort(handler) { return { calls: [], async call(url, method, params, signal) { this.calls.push({ url, method, params, signal }); return handler(method, params); } }; }

test('EVM adapter reports exact native units and provider token capability honestly', async () => {
  const rpc = rpcPort(method => method === 'eth_chainId' ? '0x2105' : '0x1e240');
  const adapter = createEvmAdapter({ chains: [{ family: 'evm', chainId: 8453, name: 'Base', nativeAsset: 'ETH', nativeDecimals: 18, rpcUrl: 'https://rpc.synthetic.invalid', explorerBaseUrl: 'https://basescan.org', capabilities: { nativeBalance: true, erc20Enumeration: 'unsupported', tokenMetadata: 'unsupported' }, builtin: true }], rpc });
  const scanned = await adapter.scan(wallet('evm', evmAddress, { autoScanCommonChains: true, chainIds: [] }), { now: 1 });
  assert.equal(scanned.status, 'partial');
  assert.equal(scanned.capability, 'token-discovery-unavailable');
  assert.equal(scanned.positions[0].baseUnits, '123456');
  assert.equal(positionFromDraft('wallet-evm', scanned.positions[0], 1, 'position-native').quantity, '0.000000000000123456');
  assert.equal((await createEvmAdapter({ chains: [], rpc: undefined }).scan(wallet('evm', evmAddress, { autoScanCommonChains: true, chainIds: [] }), { now: 1 })).status, 'unconfigured');
  assert.equal((await adapter.scan(wallet('bitcoin', btcAddress, { network: 'mainnet', addressType: 'address' }), { now: 1 })).errorCode, 'family-mismatch');
});

test('Etherscan V2 token discovery parses current-holdings fields and uses Base chain id', async () => {
  const http = httpPort({ status: '1', message: 'OK', result: [
    { TokenAddress: `0x${'a'.repeat(40)}`, TokenName: 'Synthetic Token', TokenSymbol: 'SYN', TokenDivisor: '6', TokenQuantity: '100', TokenPriceUSD: '0' },
    { TokenAddress: `0x${'a'.repeat(40)}`, TokenName: 'Synthetic Token', TokenSymbol: 'SYN', TokenDivisor: '6', TokenQuantity: '40', TokenPriceUSD: '0' },
    { TokenAddress: `0x${'b'.repeat(40)}`, TokenName: 'Zero', TokenSymbol: 'ZERO', TokenDivisor: '18', TokenQuantity: '0', TokenPriceUSD: '0' },
    { TokenAddress: 'bad', TokenName: 'Invalid', TokenSymbol: 'BAD', TokenDivisor: '6', TokenQuantity: '2', TokenPriceUSD: '0' }
  ] });
  const adapter = createEvmAdapter({ chains: [baseChain], rpc: rpcPort(() => '0x0'), erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic' } });
  const result = await adapter.scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, http, secrets: secretStore() });
  assert.equal(result.status, 'partial');
  assert.equal(result.capability, 'known-tokens');
  assert.equal(http.calls[0].secretQuery.apikey, 'synthetic-key');
  assert.match(http.calls[0].url, /chainid=8453/);
  assert.equal(result.positions.find(item => item.assetKind === 'fungible')?.chainId, 8453);
  assert.equal(http.calls[0].url.includes('synthetic-key'), false);
  const tier = await createEvmAdapter({ chains: [baseChain], rpc: rpcPort(() => '0x2105'), erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic' } }).scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, http: httpPort({ status: '0', message: 'Max rate limit reached', result: 'x' }), secrets: secretStore() });
  assert.equal(tier.errorCode, 'rate-limited');
  const unconfigured = await createEvmAdapter({ chains: [baseChain], rpc: rpcPort(() => '0x2105'), erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic' } }).scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, http, secrets: { get: () => ({ ok: true, value: null }) } });
  assert.equal(unconfigured.errorCode, 'unconfigured');
  const clean = await createEvmAdapter({ chains: [baseChain], rpc: rpcPort(() => '0x2105'), erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic' } }).scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, http: httpPort({ status: '1', result: [{ TokenAddress: `0x${'c'.repeat(40)}`, TokenName: 'Clean', TokenSymbol: 'CLEAN', TokenDivisor: 2, TokenQuantity: '7', TokenPriceUSD: '0' }] }), secrets: secretStore() });
  assert.equal(clean.status, 'partial');
  const enabled = await createEvmAdapter({ chains: [{ ...baseChain, rpcUrl: 'https://rpc.synthetic.invalid' }], rpc: rpcPort(method => method === 'eth_chainId' ? '0x2105' : '0x1') , erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic' } }).scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, settings: { enabledChainIds: [8453] }, http: httpPort({ status: '1', result: [] }), secrets: secretStore() });
  assert.equal(enabled.status, 'ok');
  const emptyNative = await createEvmAdapter({ chains: [{ ...baseChain, rpcUrl: 'https://rpc.synthetic.invalid' }], rpc: rpcPort(method => method === 'eth_chainId' ? '0x2105' : '0x0'), erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic' } }).scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, settings: { enabledChainIds: [8453] }, http: httpPort({ status: '1', result: [] }), secrets: secretStore() });
  assert.equal(emptyNative.status, 'empty');
});

test('Etherscan pagination is bounded and aggregates current holdings across pages', async () => {
  const calls = [];
  const http = httpPort(request => {
    calls.push(request);
    return new URL(request.url).searchParams.get('page') === '1' ? { status: '1', result: Array.from({ length: 100 }, () => ({ TokenAddress: `0x${'d'.repeat(40)}`, TokenName: 'Paged', TokenSymbol: 'PGD', TokenDivisor: 0, TokenQuantity: 1, TokenPriceUSD: '0' })) } : { status: '1', result: [] };
  });
  const adapter = createEvmAdapter({ chains: [baseChain], rpc: rpcPort(() => '0x2105'), erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic', rateLimit: { now: (() => { let value = 0; return () => (value += 1_000); })(), wait: async () => undefined } } });
  const scanned = await adapter.scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, http, secrets: secretStore() });
  assert.equal(calls.length, 2);
  assert.equal(scanned.positions.find(item => item.assetKind === 'fungible')?.baseUnits, '100');
});

test('Etherscan max-page and disabled-chain branches remain explicit', async () => {
  const http = httpPort(() => ({ status: '1', result: Array.from({ length: 100 }, () => ({ TokenAddress: `0x${'e'.repeat(40)}`, TokenName: 'Max', TokenSymbol: 'MAX', TokenDivisor: '18', TokenQuantity: '1' })) }));
  const adapter = createEvmAdapter({ chains: [baseChain], rpc: rpcPort(() => '0x2105'), erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic', rateLimit: { now: (() => { let value = 0; return () => (value += 1_000); })(), wait: async () => undefined } } });
  const max = await adapter.scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, http, secrets: secretStore() });
  assert.equal(max.status, 'partial');
  assert.equal(max.errorCode, 'max-page');
  const disabled = await adapter.scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, settings: { enabledChainIds: [1] }, http: httpPort({ status: '1', result: [] }), secrets: secretStore() });
  assert.equal(disabled.errorCode, 'no-enabled-chain');
});

test('Etherscan free fallback discovers fungible transfers, omits NFTs, and uses tokenbalance exactly', async () => {
  const calls = [];
  const contractA = `0x${'a'.repeat(40)}`;
  const contractB = `0x${'b'.repeat(40)}`;
  const http = httpPort(request => {
    calls.push(request);
    const action = new URL(request.url).searchParams.get('action');
    if (action === 'addresstokenbalance') return { status: '0', message: 'Free API plan does not support this endpoint.' };
    if (action === 'tokentx') return { status: '1', message: 'OK', result: [
      { contractAddress: contractA, tokenSymbol: 'SYN', tokenDecimal: '6', value: '1' },
      { contractAddress: contractA, tokenSymbol: 'SYN', tokenDecimal: '6', value: '2' },
      { contractAddress: `0x${'c'.repeat(40)}`, tokenSymbol: 'NFT', tokenDecimal: '0', tokenID: '1', value: '1' },
      { contractAddress: contractB, tokenSymbol: 'BAD', tokenDecimal: '4', value: '1' },
      { contractAddress: contractB, tokenSymbol: 'BAD', tokenDecimal: '5', value: '1' },
      null
    ] };
    if (action === 'tokenbalance' && new URL(request.url).searchParams.get('contractaddress') === contractA) return { status: '1', result: '42' };
    return { status: '1', result: '0' };
  });
  const adapter = createEvmAdapter({ chains: [baseChain], rpc: rpcPort(() => '0x2105'), erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic', maxPages: 2, maxContracts: 10, rateLimit: { now: (() => { let value = 0; return () => (value += 1_000); })(), wait: async () => undefined } } });
  const result = await adapter.scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, http, secrets: secretStore() });
  assert.equal(result.status, 'partial');
  assert.equal(result.errorCode, 'partial-response');
  assert.deepEqual(result.positions.filter(item => item.assetKind === 'fungible').map(item => [item.assetId, item.baseUnits, item.decimals]), [[contractA, '42', 6]]);
  assert.equal(calls.some(request => new URL(request.url).searchParams.get('action') === 'tokentx' && new URL(request.url).searchParams.get('offset') === '1000'), true);
  assert.equal(calls.some(request => request.url.includes('synthetic-key')), false);
});

test('Etherscan native balance fallback works without RPC and rate limits are injectable', async () => {
  const calls = [];
  const http = httpPort(request => {
    calls.push(request);
    const action = new URL(request.url).searchParams.get('action');
    if (action === 'balance') return { status: '1', result: '123456' };
    if (action === 'addresstokenbalance') return { status: '0', message: 'Free API plan does not support this endpoint.' };
    return { status: '1', result: [] };
  });
  const adapter = createEvmAdapter({ chains: [{ ...baseChain, chainId: 8453 }], rpc: undefined, erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic', rateLimit: { now: (() => { let value = 0; return () => (value += 1_000); })(), wait: async () => undefined } } });
  const result = await adapter.scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, http, secrets: secretStore() });
  assert.equal(result.status, 'ok');
  assert.equal(result.positions[0]?.baseUnits, '123456');
  assert.equal(new URL(calls[0].url).searchParams.get('action'), 'balance');
  let current = 0;
  let waits = 0;
  const limiter = createEtherscanRateLimiter({ maxPerSecond: 2, maxPerDay: 3, now: () => current, wait: async milliseconds => { waits++; current += milliseconds; } });
  await limiter.take(); await limiter.take(); await limiter.take();
  assert.equal(waits, 1);
  await assert.rejects(limiter.take(), error => error instanceof TransportError && error.status === 429);
  current += 86_400_000;
  await limiter.take();
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(limiter.take(aborted.signal), error => error instanceof TransportError && error.code === 'aborted');
  const defaultLimiter = createEtherscanRateLimiter({ maxPerSecond: 1, now: () => 0 });
  await defaultLimiter.take();
  const waitingAbort = new AbortController();
  setTimeout(() => waitingAbort.abort(), 0);
  await assert.rejects(defaultLimiter.take(waitingAbort.signal), error => error instanceof TransportError && error.code === 'aborted');
  const sharedCalls = [];
  const sharedLimiter = createEtherscanRateLimiter({ maxPerDay: 1, now: () => 0 });
  const sharedHttp = httpPort(request => { sharedCalls.push(request); return { status: '1', result: '1' }; });
  const sharedOptions = { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic', rateLimit: { maxPerDay: 1, now: () => 0 } };
  const firstShared = createEvmAdapter({ chains: [baseChain], rpc: undefined, etherscanRateLimiter: sharedLimiter, erc20: sharedOptions });
  const secondShared = createEvmAdapter({ chains: [baseChain], rpc: undefined, etherscanRateLimiter: sharedLimiter, erc20: sharedOptions });
  await firstShared.scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, http: sharedHttp, secrets: secretStore() });
  const secondResult = await secondShared.scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, http: sharedHttp, secrets: secretStore() });
  assert.equal(secondResult.errorCode, 'rate-limited');
  assert.equal(sharedCalls.length, 1);
});

test('Etherscan continues after unsupported chains and accepts validated empty transfer history', async () => {
  const chains = [1, 10, 137].map(chainId => ({ ...baseChain, chainId, name: `Synthetic ${chainId}`, rpcUrl: chainId === 1 ? 'https://rpc.synthetic.invalid' : null }));
  const calls = [];
  const rpc = rpcPort(method => method === 'eth_chainId' ? '0x1' : '0x5');
  const multi = httpPort(request => {
    calls.push(request);
    const params = new URL(request.url).searchParams;
    const chainId = Number(params.get('chainid'));
    const action = params.get('action');
    if (action === 'balance') {
      if (chainId === 10) return { status: '0', message: 'Chain not supported by this plan', result: '0' };
      return { status: '1', result: chainId === 1 ? '11' : '22' };
    }
    if (action === 'addresstokenbalance') {
      if (chainId === 10) return { status: '0', message: 'Chain not supported by this plan', result: [] };
      return { status: '1', result: [{ TokenAddress: `0x${String(chainId).padStart(40, 'a')}`, TokenSymbol: `S${chainId}`, TokenDivisor: '2', TokenQuantity: '3' }] };
    }
    return { status: '1', result: [] };
  });
  const adapter = createEvmAdapter({ chains, rpc, erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic' } });
  const scanned = await adapter.scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [1, 10, 137] }), { now: 1, http: multi, secrets: secretStore() });
  assert.equal(scanned.status, 'partial');
  assert.equal(scanned.positions.some(item => item.chainId === 1 && item.assetKind === 'native'), true);
  assert.equal(scanned.positions.some(item => item.chainId === 137 && item.assetKind === 'native'), true);
  assert.equal(scanned.positions.some(item => item.chainId === 137 && item.assetKind === 'fungible'), true);
  assert.equal(rpc.calls.every(call => call.url === 'https://rpc.synthetic.invalid'), true);
  assert.equal(calls.some(request => new URL(request.url).searchParams.get('action') === 'balance' && new URL(request.url).searchParams.get('chainid') === '137'), true);

  const emptyCalls = httpPort(request => {
    const action = new URL(request.url).searchParams.get('action');
    if (action === 'balance') return { status: '1', result: '0' };
    if (action === 'addresstokenbalance') return { status: '0', message: 'Free API plan does not support this endpoint.', result: [] };
    if (action === 'tokentx') return { status: '0', message: 'No transactions found', result: [] };
    return { status: '1', result: '0' };
  });
  const empty = await createEvmAdapter({ chains: [baseChain], rpc: undefined, erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic' } }).scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, http: emptyCalls, secrets: secretStore() });
  assert.equal(empty.status, 'empty');
  assert.deepEqual(empty.positions, []);

  const fallbackChains = [{ ...baseChain, chainId: 1 }, { ...baseChain, chainId: 137 }];
  const fallbackCalls = [];
  const fallbackHttp = httpPort(request => {
    fallbackCalls.push(request);
    const params = new URL(request.url).searchParams;
    const action = params.get('action');
    const chainId = Number(params.get('chainid'));
    if (action === 'addresstokenbalance') return { status: '0', message: 'Free API plan does not support this endpoint.', result: [] };
    if (action === 'tokentx' && chainId === 1) return { status: '1', result: [{ contractAddress: `0x${'f'.repeat(40)}`, tokenSymbol: 'FALL', tokenDecimal: '2', value: '1' }] };
    if (action === 'tokenbalance' && chainId === 1) return { status: '0', message: 'Chain not supported by this plan', result: '0' };
    if (action === 'tokentx') return { status: '0', message: 'No transactions found', result: [] };
    return { status: '1', result: '0' };
  });
  const fallbackResult = await createEvmAdapter({ chains: fallbackChains, rpc: rpcPort(() => '0x1'), erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic' } }).scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [1, 137] }), { now: 1, http: fallbackHttp, secrets: secretStore() });
  assert.equal(fallbackResult.status, 'partial');
  assert.equal(fallbackCalls.some(request => new URL(request.url).searchParams.get('action') === 'tokentx' && new URL(request.url).searchParams.get('chainid') === '137'), true);
});

test('Etherscan fallback treats non-capability chain errors as terminal and keeps empty partial coverage honest', async () => {
  const chains = [1, 10, 137].map(chainId => ({ ...baseChain, chainId, name: `Synthetic ${chainId}`, rpcUrl: chainId === 1 ? 'https://rpc.synthetic.invalid' : null }));
  const rpc = rpcPort(method => method === 'eth_chainId' ? '0x1' : '0x0');
  const http = httpPort(request => {
    const params = new URL(request.url).searchParams;
    const action = params.get('action');
    const chainId = Number(params.get('chainid'));
    if (action === 'balance') {
      if (chainId === 10) return { status: '0', message: 'Chain not supported by this plan', result: '0' };
      return { status: '1', result: '0' };
    }
    if (action === 'addresstokenbalance') {
      return { status: '0', message: 'Free API plan does not support this endpoint.', result: [] };
    }
    if (action === 'tokentx') return { status: '0', message: 'chain offline', result: [] };
    return { status: '1', result: '0' };
  });
  const terminal = await createEvmAdapter({ chains: [baseChain], rpc: undefined, erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic' } }).scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, http, secrets: secretStore() });
  assert.equal(terminal.errorCode, 'provider-error');
  const partial = await createEvmAdapter({ chains, rpc, erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic' } }).scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [1, 10, 137] }), { now: 1, http: httpPort(request => {
    const params = new URL(request.url).searchParams;
    const action = params.get('action');
    const chainId = Number(params.get('chainid'));
    if (action === 'balance') return chainId === 10 ? { status: '0', message: 'Chain not supported by this plan', result: '0' } : { status: '1', result: '0' };
    if (action === 'addresstokenbalance') return chainId === 10 ? { status: '0', message: 'Chain not supported by this plan', result: [] } : { status: '1', result: [] };
    return { status: '1', result: [] };
  }), secrets: secretStore() });
  assert.equal(partial.status, 'partial');
  assert.deepEqual(partial.positions, []);
  const partialWithPosition = await createEvmAdapter({ chains, rpc: rpcPort(() => { throw new TransportError('http', 'hidden'); }), erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic' } }).scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [1, 10, 137] }), { now: 1, http: httpPort(request => {
    const params = new URL(request.url).searchParams;
    const action = params.get('action');
    const chainId = Number(params.get('chainid'));
    if (action === 'balance') return chainId === 10 ? { status: '0', message: 'Chain not supported by this plan', result: '0' } : { status: '1', result: chainId === 137 ? '22' : '0' };
    if (action === 'addresstokenbalance') return chainId === 10 ? { status: '0', message: 'Chain not supported by this plan', result: [] } : { status: '1', result: [] };
    return { status: '1', result: [] };
  }), secrets: secretStore() });
  assert.equal(partialWithPosition.status, 'partial');
  assert.equal(partialWithPosition.positions.some(item => item.chainId === 137 && item.assetKind === 'native'), true);
});

test('Etherscan free fallback paginates full 1000-row pages and maps transport failures', async () => {
  const contract = `0x${'f'.repeat(40)}`;
  let pageCalls = 0;
  const paged = httpPort(request => {
    const params = new URL(request.url).searchParams;
    if (params.get('action') === 'addresstokenbalance') return { status: '0', message: 'PRO endpoint required' };
    if (params.get('action') === 'tokentx') { pageCalls++; return params.get('page') === '1' ? { status: '1', result: Array.from({ length: 1_000 }, () => ({ contractAddress: contract, tokenSymbol: 'PAGE', tokenDecimal: '2', value: '1' })) } : { status: '1', result: [] }; }
    return { status: '1', result: '9' };
  });
  const adapter = createEvmAdapter({ chains: [baseChain], rpc: rpcPort(() => '0x2105'), erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic', maxPages: 2, rateLimit: { now: (() => { let value = 0; return () => (value += 1_000); })(), wait: async () => undefined } } });
  const result = await adapter.scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, http: paged, secrets: secretStore() });
  assert.equal(pageCalls, 2); assert.equal(result.status, 'partial'); assert.equal(result.positions[0]?.baseUnits, '9');
  const failed = await adapter.scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, http: httpPort(request => new URL(request.url).searchParams.get('action') === 'addresstokenbalance' ? { status: '0', message: 'PRO endpoint required' } : (() => { throw new TransportError('timeout', 'hidden'); })()), secrets: secretStore() });
  assert.equal(failed.status, 'error'); assert.equal(failed.errorCode, 'timeout');
  const nativeFailed = await createEvmAdapter({ chains: [baseChain], rpc: undefined, erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic', rateLimit: { now: (() => { let value = 0; return () => (value += 1_000); })(), wait: async () => undefined } } }).scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, http: httpPort(() => { throw new TransportError('timeout', 'hidden'); }), secrets: secretStore() });
  assert.equal(nativeFailed.status, 'error'); assert.equal(nativeFailed.errorCode, 'timeout');
});

test('Etherscan fallback rejects malformed, capped, and native error responses explicitly', async () => {
  const contractA = `0x${'1'.repeat(40)}`;
  const contractB = `0x${'2'.repeat(40)}`;
  const evm = wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] });
  const options = { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic', maxPages: 2, rateLimit: { now: (() => { let value = 0; return () => (value += 1_000); })(), wait: async () => undefined } };
  const scan = (http, extra = {}) => createEvmAdapter({ chains: [baseChain], rpc: rpcPort(() => '0x2105'), erc20: { ...options, ...extra } }).scan(evm, { now: 1, http, secrets: secretStore() });
  const hugeDecimals = await scan(httpPort({ status: '1', result: [{ TokenAddress: contractA, TokenSymbol: 'BIG', TokenDivisor: '999999999999999999999999', TokenQuantity: '1' }] }));
  assert.equal(hugeDecimals.errorCode, 'invalid-response');
  const transferMalformed = await scan(httpPort(request => new URL(request.url).searchParams.get('action') === 'addresstokenbalance' ? { status: '0', message: 'PRO endpoint required' } : { status: '1', result: {} }));
  assert.equal(transferMalformed.errorCode, 'invalid-response');
  const transferFields = await scan(httpPort(request => {
    const action = new URL(request.url).searchParams.get('action');
    if (action === 'addresstokenbalance') return { status: '0', message: 'PRO endpoint required' };
    return { status: '1', result: [
      { contractAddress: 5, tokenSymbol: 6, tokenDecimal: 'bad', value: '1' },
      { contractAddress: contractA, tokenSymbol: '', tokenDecimal: '2', value: '1' },
      { contractAddress: 'bad', tokenSymbol: 'BAD', tokenDecimal: '2', value: '1' }
    ] };
  }));
  assert.equal(transferFields.errorCode, 'invalid-response');
  const capped = await scan(httpPort(request => {
    const action = new URL(request.url).searchParams.get('action');
    if (action === 'addresstokenbalance') return { status: '0', message: 'PRO endpoint required' };
    if (action === 'tokentx') return { status: '1', result: [
      { contractAddress: contractA, tokenSymbol: 'A', tokenDecimal: '6', value: '1' },
      { contractAddress: contractB, tokenSymbol: 'B', tokenDecimal: '6', value: '1' }
    ] };
    return { status: '1', result: '0' };
  }), { maxContracts: 1 });
  assert.equal(capped.status, 'partial'); assert.equal(capped.errorCode, 'cap-reached'); assert.equal(capped.positions.length, 0);
  const cappedByPage = await scan(httpPort(request => {
    const action = new URL(request.url).searchParams.get('action');
    if (action === 'addresstokenbalance') return { status: '0', message: 'PRO endpoint required' };
    if (action === 'tokentx') return { status: '1', result: Array.from({ length: 1_000 }, () => ({ contractAddress: contractA, tokenSymbol: 'A', tokenDecimal: '6', value: '1' })) };
    return { status: '1', result: '0' };
  }), { maxPages: 1 });
  assert.equal(cappedByPage.status, 'partial'); assert.equal(cappedByPage.errorCode, 'cap-reached');
  const tokenFailure = await scan(httpPort(request => {
    const action = new URL(request.url).searchParams.get('action');
    if (action === 'addresstokenbalance') return { status: '0', message: 'PRO endpoint required' };
    if (action === 'tokentx') return { status: '1', result: [{ contractAddress: contractA, tokenSymbol: 'A', tokenDecimal: '6', value: '1' }] };
    return { status: '0', message: 'unexpected response' };
  }));
  assert.equal(tokenFailure.status, 'error'); assert.equal(tokenFailure.errorCode, 'provider-error');
  const tokenMalformed = await scan(httpPort(request => {
    const action = new URL(request.url).searchParams.get('action');
    if (action === 'addresstokenbalance') return { status: '0', message: 'PRO endpoint required' };
    if (action === 'tokentx') return { status: '1', result: [{ contractAddress: contractA, tokenSymbol: 'A', tokenDecimal: '6', value: '1' }] };
    return { status: '1', result: 'not-a-number' };
  }));
  assert.equal(tokenMalformed.status, 'error'); assert.equal(tokenMalformed.errorCode, 'invalid-response');
  const noKeyNative = await createEvmAdapter({ chains: [baseChain], rpc: undefined, erc20: options }).scan(evm, { now: 1, http: httpPort({}), secrets: { get: () => ({ ok: true, value: null }) } });
  assert.equal(noKeyNative.status, 'unconfigured');
  const noSelectedNative = await createEvmAdapter({ chains: [baseChain], rpc: undefined, erc20: options }).scan({ ...evm, options: { autoScanCommonChains: false, chainIds: [1] } }, { now: 1, http: httpPort({}), secrets: secretStore() });
  assert.equal(noSelectedNative.errorCode, 'no-enabled-chain');
  const nativeProviderError = await createEvmAdapter({ chains: [baseChain], rpc: undefined, erc20: options }).scan(evm, { now: 1, http: httpPort(() => ({ status: '0', message: 'unexpected response' })), secrets: secretStore() });
  assert.equal(nativeProviderError.errorCode, 'provider-error');
  const nativeInvalid = await createEvmAdapter({ chains: [baseChain], rpc: undefined, erc20: options }).scan(evm, { now: 1, http: httpPort(() => ({ status: '1', result: 'not-a-number' })), secrets: secretStore() });
  assert.equal(nativeInvalid.errorCode, 'invalid-response');
  const nativeEmpty = await createEvmAdapter({ chains: [baseChain], rpc: undefined, erc20: options }).scan(evm, { now: 1, http: httpPort(request => new URL(request.url).searchParams.get('action') === 'addresstokenbalance' ? { status: '1', result: [] } : { status: '1', result: '0' }), secrets: secretStore() });
  assert.equal(nativeEmpty.status, 'empty');
  const noProgress = createEtherscanRateLimiter({ maxPerSecond: 1, now: () => 0, wait: async () => undefined });
  await noProgress.take();
  await assert.rejects(noProgress.take(), error => error instanceof TransportError && error.status === 429);
  const abortAfterWait = new AbortController();
  const abortingLimiter = createEtherscanRateLimiter({ maxPerSecond: 1, now: () => 0, wait: async () => { abortAfterWait.abort(); } });
  await abortingLimiter.take();
  await assert.rejects(abortingLimiter.take(abortAfterWait.signal), error => error instanceof TransportError && error.code === 'aborted');
  let clock = 0;
  const dayReset = createEtherscanRateLimiter({ maxPerSecond: 1, maxPerDay: 2, now: () => clock, wait: async () => { clock = 86_400_001; } });
  await dayReset.take(); await dayReset.take();
  assert.equal(clock, 86_400_001);
  let dailyClock = 0;
  let dailyAfterWait;
  dailyAfterWait = createEtherscanRateLimiter({ maxPerSecond: 1, maxPerDay: 2, now: () => dailyClock, wait: async () => { dailyClock = 1_000; await dailyAfterWait.take(); } });
  await dailyAfterWait.take();
  await assert.rejects(dailyAfterWait.take(), error => error instanceof TransportError && error.status === 429);
  const defaultNoSignal = createEtherscanRateLimiter({ maxPerSecond: 1 });
  await defaultNoSignal.take(); await defaultNoSignal.take();
});

test('Bitcoin adapter preserves confirmed and mempool quantities and rejects xpubs', async () => {
  const response = { chain_stats: { funded_txo_sum: '1000', spent_txo_sum: '200' }, mempool_stats: { funded_txo_sum: '30', spent_txo_sum: '10' } };
  const http = httpPort(response);
  const adapter = createBitcoinAdapter();
  const result = await adapter.scan(wallet('bitcoin', btcAddress, { network: 'mainnet', addressType: 'address' }), { now: 1, http });
  assert.equal(result.status, 'ok');
  assert.deepEqual([result.positions[0].baseUnits, result.positions[0].confirmedBaseUnits, result.positions[0].pendingBaseUnits], ['820', '800', '20']);
  assert.match(http.calls[0].url, /mempool\.space\/api\/address/);
  const testnet = await createBitcoinAdapter().scan(wallet('bitcoin', btcTestnet, { network: 'testnet', addressType: 'address' }), { now: 1, http: httpPort({ chain_stats: { funded_txo_sum: '0', spent_txo_sum: '0' }, mempool_stats: { funded_txo_sum: '0', spent_txo_sum: '0' } }) });
  assert.equal(testnet.status, 'empty');
  assert.equal((await adapter.scan(wallet('bitcoin', btcAddress, { network: 'mainnet', addressType: 'xpub' }), { now: 1, http })).errorCode, 'xpub-unsupported');
  assert.equal((await adapter.scan(wallet('bitcoin', btcAddress, { network: 'mainnet', addressType: 'address' }), { now: 1 })).status, 'unconfigured');
  assert.equal((await adapter.scan(wallet('bitcoin', btcAddress, { network: 'mainnet', addressType: 'address' }), { now: 1, http: httpPort({}, new TransportError('http', 'hidden', 429)) })).status, 'rate-limited');
  assert.equal(positionFromDraft('wallet-bitcoin', result.positions[0], 2, 'position-1').quantity, '0.0000082');
  const numeric = await adapter.scan(wallet('bitcoin', btcAddress, { network: 'mainnet', addressType: 'address' }), { now: 1, http: httpPort({ chain_stats: { funded_txo_sum: 1000, spent_txo_sum: 200 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 } }) });
  assert.equal(numeric.positions[0].pendingBaseUnits, '0');
  const outflow = await adapter.scan(wallet('bitcoin', btcAddress, { network: 'mainnet', addressType: 'address' }), { now: 1, http: httpPort({ chain_stats: { funded_txo_sum: 1000, spent_txo_sum: 200 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 700 } }) });
  assert.equal(outflow.positions[0].pendingBaseUnits, '-700');
  const totalNegative = await adapter.scan(wallet('bitcoin', btcAddress, { network: 'mainnet', addressType: 'address' }), { now: 1, http: httpPort({ chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 1 } }) });
  assert.equal(totalNegative.errorCode, 'invalid-response');
  const invalidNumber = await adapter.scan(wallet('bitcoin', btcAddress, { network: 'mainnet', addressType: 'address' }), { now: 1, http: httpPort({ chain_stats: { funded_txo_sum: -1, spent_txo_sum: 0 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 } }) });
  assert.equal(invalidNumber.errorCode, 'invalid-response');
});

test('Solana adapter uses raw token amounts, aggregates programs, and fails closed on malformed rows', async () => {
  const rpc = rpcPort((method, params) => {
    if (method === 'getBalance') return { context: { slot: 1 }, value: 1000000000 };
    return params[1].programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' ? { value: [
      { pubkey: 'AccountSynthetic', account: { data: { program: 'spl-token', parsed: { info: { mint: 'MintSynthetic', tokenAmount: { amount: '2', decimals: 2, uiAmount: 0.02 } } } } } },
      { pubkey: 'AccountSynthetic2', account: { data: { program: 'spl-token', parsed: { info: { mint: 'MintSynthetic', tokenAmount: { amount: '3', decimals: 2 } } } } } },
      { pubkey: 'AccountZero', account: { data: { program: 'spl-token', parsed: { info: { mint: 'Zero', tokenAmount: { amount: '0', decimals: 2 } } } } } },
      { pubkey: 'AccountNftLike', account: { data: { program: 'spl-token', parsed: { info: { mint: 'NFTLike', tokenAmount: { amount: '1', decimals: 0 } } } } } }
    ] } : { value: [] };
  });
  const adapter = createSolanaAdapter({ endpoint: 'https://solana.synthetic.invalid' });
  const result = await adapter.scan(wallet('solana', solAddress, { network: 'devnet' }), { now: 1, rpc });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.positions.map(item => item.baseUnits), ['1000000000', '5']);
  const malformed = await adapter.scan(wallet('solana', solAddress, { network: 'devnet' }), { now: 1, rpc: rpcPort(() => ({ value: null })) });
  assert.equal(malformed.errorCode, 'invalid-response');
  const partial = await adapter.scan(wallet('solana', solAddress, { network: 'devnet' }), { now: 1, rpc: { calls: [], async call(url, method) { this.calls.push(method); if (method === 'getBalance') return { context: {}, value: 1 }; throw new TransportError('timeout', 'hidden'); } } });
  assert.equal(partial.status, 'partial');
  assert.equal((await adapter.scan(wallet('solana', solAddress, { network: 'devnet' }), { now: 1 })).status, 'unconfigured');
});

test('Solana defaults follow the selected cluster, omit zero native balances, and reject mint decimal conflicts', async () => {
  const calls = [];
  const defaultRpc = rpcPort((method, params) => {
    calls.push({ method, params });
    if (method === 'getBalance') return { context: {}, value: 0 };
    return { value: [{ account: { data: { parsed: { info: { mint: 'ConflictMint', tokenAmount: { amount: '1', decimals: params[1].programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' ? 2 : 3 } } } } } }] };
  });
  const result = await createSolanaAdapter().scan(wallet('solana', solAddress, { network: 'mainnet-beta' }), { now: 1, rpc: defaultRpc });
  assert.equal(result.errorCode, 'invalid-response');
  assert.equal(defaultRpc.calls[0].url, 'https://api.mainnet.solana.com');
  assert.deepEqual(defaultRpc.calls[0].params[1], { commitment: 'finalized' });
  assert.equal(defaultRpc.calls[1].params[1].programId, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  assert.equal(defaultRpc.calls[2].params[1].programId, 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
  const zero = await createSolanaAdapter({ endpoint: 'https://solana.synthetic.invalid' }).scan(wallet('solana', solAddress, { network: 'devnet' }), { now: 1, rpc: rpcPort((method) => method === 'getBalance' ? { context: {}, value: 0 } : { value: [] }) });
  assert.equal(zero.status, 'empty');
  assert.deepEqual(zero.positions, []);
});

test('Cardano Koios adapter validates address info and excludes uncertain assets', async () => {
  const http = httpPort(value => value.url.endsWith('address_info') ? [{ address: cardanoAddress, balance: '1234567' }] : [
    { policy_id: 'policy', asset_name: 'FUNGIBLE', fingerprint: 'asset1synthetic', quantity: '12', decimals: 1 },
    { policy_id: 'policy', asset_name: 'NFT', fingerprint: 'asset1nftsynthetic', quantity: '1', decimals: 0 },
    { policy_id: 'policy', asset_name: 'UNKNOWN', fingerprint: 'asset1unknown', quantity: '1' }
  ]);
  const adapter = createCardanoAdapter();
  const result = await adapter.scan(wallet('cardano', cardanoAddress, { network: 'mainnet' }), { now: 1, http });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.positions.map(item => item.assetId), ['native:ada', 'asset1synthetic']);
  assert.match(http.calls[0].url, /api\.koios\.rest/);
  const partial = await adapter.scan(wallet('cardano', cardanoAddress, { network: 'testnet' }), { now: 1, http: httpPort(value => value.url.endsWith('address_info') ? [{ balance: '1' }] : null) });
  assert.equal(partial.status, 'partial');
  const malformed = await adapter.scan(wallet('cardano', cardanoAddress, { network: 'mainnet' }), { now: 1, http: httpPort([]) });
  assert.equal(malformed.errorCode, 'invalid-response');
  assert.equal((await adapter.scan(wallet('cardano', cardanoAddress, { network: 'mainnet' }), { now: 1 })).status, 'unconfigured');
  assert.equal((await adapter.scan(wallet('cardano', cardanoAddress, { network: 'mainnet' }), { now: 1, http: httpPort({}, new TransportError('aborted', 'hidden')) })).status, 'aborted');
});

test('Cardano stake adapters use account endpoints and keep zero ADA empty', async () => {
  const http = httpPort(request => request.url.endsWith('account_info') ? [{ total_balance: 0 }] : [{ policy_id: 'policy', asset_name: '', fingerprint: 'asset1stake', quantity: '2', decimals: 2 }]);
  const result = await createCardanoAdapter({ mainnetEndpoint: 'https://koios.synthetic.invalid/api/v1' }).scan(wallet('cardano', stakeCardanoAddress, { network: 'mainnet', kind: 'stake' }), { now: 1, http });
  assert.equal(result.status, 'ok');
  assert.equal(result.positions[0].symbol, 'asset1st');
  assert.match(http.calls[0].url, /account_info/);
  assert.deepEqual(http.calls[0].body, { _stake_addresses: [stakeCardanoAddress] });
  const empty = await createCardanoAdapter().scan(wallet('cardano', stakeCardanoAddress, { network: 'mainnet', kind: 'stake' }), { now: 1, http: httpPort(request => request.url.endsWith('account_info') ? [{ total_balance: 0 }] : []) });
  assert.equal(empty.status, 'empty');
});

test('adapter provider errors are redacted and malformed EVM envelopes do not become holdings', async () => {
  const adapter = createEvmAdapter({ chains: [baseChain], rpc: rpcPort(() => '0x2105'), erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic' } });
  const malformed = await adapter.scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, http: httpPort({ status: '1', result: {} }), secrets: secretStore() });
  assert.equal(malformed.errorCode, 'invalid-response');
  const failedSecret = await adapter.scan(wallet('evm', evmAddress, { autoScanCommonChains: false, chainIds: [8453] }), { now: 1, http: httpPort({}), secrets: { get: () => ({ ok: false, code: 'storage-failed', message: 'hidden' }) } });
  assert.equal(failedSecret.errorCode, 'storage-failed');
  const network = await createBitcoinAdapter().scan(wallet('bitcoin', btcAddress, { network: 'mainnet', addressType: 'address' }), { now: 1, http: httpPort({}, new Error('secret must not escape')) });
  assert.equal(network.errorCode, 'network');
});

test('EVM adapter fail-closed branches cover provider tiers, malformed token rows, and native partials', async () => {
  const base = { family: 'evm', chainId: 1, name: 'Ethereum', nativeAsset: 'ETH', nativeDecimals: 18, rpcUrl: null, explorerBaseUrl: 'https://etherscan.io', capabilities: { nativeBalance: true, erc20Enumeration: 'unsupported', tokenMetadata: 'unsupported' }, builtin: true };
  const evm = wallet('evm', evmAddress, { autoScanCommonChains: true, chainIds: [] });
  const opts = { endpoint: 'https://api.etherscan.io/v2/api', keyId: 'ref_evm.erc20_synthetic' };
  const malformedRows = await createEvmAdapter({ chains: [baseChain], rpc: rpcPort(() => '0x2105'), erc20: opts }).scan(evm, { now: 1, http: httpPort({ status: '1', result: [null, { TokenAddress: `0x${'a'.repeat(40)}`, TokenSymbol: 'A', TokenDivisor: 2, TokenQuantity: '3' }, { TokenAddress: `0x${'b'.repeat(40)}`, TokenSymbol: 'B', TokenDivisor: 2, TokenQuantity: '4' }] }), secrets: secretStore() });
  assert.equal(malformedRows.status, 'partial');
  const empty = await createEvmAdapter({ chains: [baseChain], rpc: rpcPort(() => '0x2105'), erc20: opts }).scan({ ...evm, options: { autoScanCommonChains: false, chainIds: [8453] } }, { now: 1, http: httpPort({ status: '1', result: [] }), secrets: secretStore() });
  assert.equal(empty.status, 'partial');
  const unsupported = await createEvmAdapter({ chains: [baseChain], rpc: rpcPort(() => '0x2105'), erc20: opts }).scan({ ...evm, options: { autoScanCommonChains: false, chainIds: [8453] } }, { now: 1, http: httpPort({ status: '0' }), secrets: secretStore() });
  assert.equal(unsupported.errorCode, 'provider-tier');
  const invalidEnvelope = await createEvmAdapter({ chains: [baseChain], rpc: rpcPort(() => '0x2105'), erc20: opts }).scan({ ...evm, options: { autoScanCommonChains: false, chainIds: [8453] } }, { now: 1, http: httpPort(null), secrets: secretStore() });
  assert.equal(invalidEnvelope.errorCode, 'invalid-response');
  const malformedFields = await createEvmAdapter({ chains: [baseChain], rpc: rpcPort(() => '0x2105'), erc20: opts }).scan({ ...evm, options: { autoScanCommonChains: false, chainIds: [8453] } }, { now: 1, http: httpPort({ status: '1', result: [{ TokenAddress: 5, TokenSymbol: 6, TokenDivisor: 2, TokenQuantity: '1' }] }), secrets: secretStore() });
  assert.equal(malformedFields.errorCode, 'invalid-response');
  const transportFailure = await createEvmAdapter({ chains: [baseChain], rpc: rpcPort(() => '0x2105'), erc20: opts }).scan({ ...evm, options: { autoScanCommonChains: false, chainIds: [8453] } }, { now: 1, http: httpPort({}, new TransportError('timeout', 'hidden')), secrets: secretStore() });
  assert.equal(transportFailure.errorCode, 'timeout');
  const noHttp = await createEvmAdapter({ chains: [baseChain], rpc: rpcPort(() => '0x2105'), erc20: {} }).scan(evm, { now: 1 });
  assert.equal(noHttp.errorCode, 'unconfigured');
  const noKey = await createEvmAdapter({ chains: [baseChain], rpc: rpcPort(() => '0x2105'), erc20: opts }).scan(evm, { now: 1, http: httpPort({}), secrets: undefined });
  assert.equal(noKey.errorCode, 'unconfigured');
  const unconfiguredNative = await createEvmAdapter({ chains: [base], rpc: rpcPort(() => '0x0') }).scan(evm, { now: 1 });
  assert.equal(unconfiguredNative.status, 'unconfigured');
  const partialNative = await createEvmAdapter({ chains: [base], rpc: rpcPort(() => '0x0'), scanCoordinator: { scan: async () => [{ family: 'evm', chainId: 1, asset: 'ETH', decimals: 18, status: 'error', balanceWei: null, quantity: null, errorCode: 'rpc' }], active: () => 0 } }).scan(evm, { now: 1 });
  assert.equal(partialNative.status, 'error');
});

test('adapter transport status mapping and family/network validation are explicit', async () => {
  const btc = createBitcoinAdapter({ endpoint: 'https://mempool.synthetic.invalid/api' });
  assert.equal((await btc.scan(wallet('bitcoin', 'bad', { network: 'mainnet', addressType: 'address' }), { now: 1, http: httpPort({}) })).errorCode, 'invalid-address');
  const timeout = await btc.scan(wallet('bitcoin', btcAddress, { network: 'mainnet', addressType: 'address' }), { now: 1, http: httpPort({}, new TransportError('timeout', 'hidden')) });
  assert.equal(timeout.errorCode, 'timeout');
  const httpError = await btc.scan(wallet('bitcoin', btcAddress, { network: 'mainnet', addressType: 'address' }), { now: 1, http: httpPort({}, new TransportError('http', 'hidden', 500)) });
  assert.equal(httpError.errorCode, 'http');
  const malformed = await btc.scan(wallet('bitcoin', btcAddress, { network: 'mainnet', addressType: 'address' }), { now: 1, http: httpPort({ chain_stats: {}, mempool_stats: {} }) });
  assert.equal(malformed.errorCode, 'invalid-response');
  const negative = await btc.scan(wallet('bitcoin', btcAddress, { network: 'mainnet', addressType: 'address' }), { now: 1, http: httpPort({ chain_stats: { funded_txo_sum: '0', spent_txo_sum: '1' }, mempool_stats: { funded_txo_sum: '0', spent_txo_sum: '0' } }) });
  assert.equal(negative.errorCode, 'invalid-response');
  assert.equal((await btc.scan(wallet('bitcoin', btcAddress, { network: 'mainnet', addressType: 'address' }), { now: 1, http: httpPort(null) })).errorCode, 'invalid-response');
  assert.equal((await btc.scan(wallet('bitcoin', btcAddress, { network: 'mainnet', addressType: 'address' }), { now: 1, http: httpPort({ chain_stats: {} }) })).errorCode, 'invalid-response');
  assert.equal((await createBitcoinAdapter().scan(wallet('evm', evmAddress, { autoScanCommonChains: true, chainIds: [] }), { now: 1 })).errorCode, 'family-mismatch');
  assert.equal((await createCardanoAdapter().scan(wallet('evm', evmAddress, { autoScanCommonChains: true, chainIds: [] }), { now: 1 })).errorCode, 'family-mismatch');
  assert.equal((await createSolanaAdapter().scan(wallet('evm', evmAddress, { autoScanCommonChains: true, chainIds: [] }), { now: 1 })).errorCode, 'family-mismatch');
});

test('Solana and Cardano malformed envelopes, aborts, and custom endpoints are fail-closed', async () => {
  const sol = createSolanaAdapter({ endpoint: 'https://solana.custom.invalid' });
  const malformedAccount = await sol.scan(wallet('solana', solAddress, { network: 'mainnet-beta' }), { now: 1, rpc: rpcPort((method) => method === 'getBalance' ? { context: {}, value: 1 } : { value: [null] }) });
  assert.equal(malformedAccount.errorCode, 'invalid-response');
  const malformedRows = [
    { value: {} },
    { value: [{ account: null }] },
    { value: [{ account: { data: null } }] },
    { value: [{ account: { data: { parsed: null } } }] },
    { value: [{ account: { data: { parsed: { info: null } } } }] },
    { value: [{ account: { data: { parsed: { info: { tokenAmount: null } } } } }] },
    { value: [{ account: { data: { parsed: { info: { mint: 4, tokenAmount: { amount: '1', decimals: 2 } } } } } }] },
    { value: [{ account: { data: { parsed: { info: { mint: 'bad', tokenAmount: { amount: 'x', decimals: 2 } } } } } }] }
  ];
  for (const row of malformedRows) {
    const malformedRow = await sol.scan(wallet('solana', solAddress, { network: 'mainnet-beta' }), { now: 1, rpc: rpcPort(method => method === 'getBalance' ? { context: {}, value: 1 } : row) });
    assert.equal(malformedRow.errorCode, 'invalid-response');
  }
  const primitiveNative = await sol.scan(wallet('solana', solAddress, { network: 'mainnet-beta' }), { now: 1, rpc: rpcPort(method => method === 'getBalance' ? null : { value: [] }) });
  assert.equal(primitiveNative.errorCode, 'invalid-response');
  const primitiveTokens = await sol.scan(wallet('solana', solAddress, { network: 'mainnet-beta' }), { now: 1, rpc: rpcPort(method => method === 'getBalance' ? { context: {}, value: 1 } : null) });
  assert.equal(primitiveTokens.errorCode, 'invalid-response');
  const aborted = await sol.scan(wallet('solana', solAddress, { network: 'mainnet-beta' }), { now: 1, rpc: { async call(url, method) { if (method === 'getBalance') return { context: {}, value: 1 }; throw new TransportError('aborted', 'hidden'); } } });
  assert.equal(aborted.errorCode, 'aborted');
  const outerError = await sol.scan(wallet('solana', solAddress, { network: 'mainnet-beta' }), { now: 1, rpc: { async call() { throw new Error('hidden'); } } });
  assert.equal(outerError.errorCode, 'network');
  const card = createCardanoAdapter({ mainnetEndpoint: 'https://koios.custom.invalid/api/v1', testnetEndpoint: 'https://koios.test.invalid/api/v1' });
  const nullInfo = await card.scan(wallet('cardano', cardanoAddress, { network: 'mainnet' }), { now: 1, http: httpPort([null]) });
  assert.equal(nullInfo.errorCode, 'invalid-response');
  const nullAssets = await card.scan(wallet('cardano', cardanoAddress, { network: 'testnet' }), { now: 1, http: httpPort(value => value.url.endsWith('address_info') ? [{ balance: '1' }] : [null]) });
  assert.equal(nullAssets.status, 'partial');
  const malformedAsset = await card.scan(wallet('cardano', cardanoAddress, { network: 'mainnet' }), { now: 1, http: httpPort(value => value.url.endsWith('address_info') ? [{ balance: '1' }] : [{ policy_id: 1, asset_name: 2, fingerprint: 3, quantity: '3', decimals: 0 }]) });
  assert.equal(malformedAsset.status, 'ok');
});

test('adapter draft conversion keeps explicit exact-unit metadata and spam assessment', () => {
  const draft = { family: 'evm', chainId: 1, assetKind: 'fungible', assetId: 'token', symbol: 'SYN', baseUnits: '100', confirmedBaseUnits: '90', pendingBaseUnits: '10', decimals: 2, spam: { riskFlags: ['unverified'], reasons: ['synthetic fixture'], hiddenByDefault: true } };
  const position = positionFromDraft('wallet-evm', draft, 1, 'position-token');
  assert.deepEqual({ baseUnits: position.baseUnits, quantity: position.quantity, confirmed: position.confirmedBaseUnits, pending: position.pendingBaseUnits, spam: position.spam }, { baseUnits: '100', quantity: '1', confirmed: '90', pending: '10', spam: draft.spam });
  const defaults = positionFromDraft('wallet-evm', { ...draft, confirmedBaseUnits: undefined, pendingBaseUnits: undefined, spam: undefined }, 1, 'position-defaults');
  assert.deepEqual({ confirmed: defaults.confirmedBaseUnits, pending: defaults.pendingBaseUnits, spam: defaults.spam }, { confirmed: '100', pending: '0', spam: null });
});
