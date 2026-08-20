import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMON_EVM_CHAINS, createChainRegistry, resolveChains, validateCustomChain, validateEndpointUrl } from '../src/shared/chains.ts';

function input(overrides = {}) {
  return { chainId: 900001, name: 'Synthetic Chain', nativeAsset: 'SYN', rpcUrl: 'https://rpc.synthetic.invalid', explorerBaseUrl: 'https://explorer.synthetic.invalid', ...overrides };
}

test('common EVM registry contains the documented networks and capability flags', () => {
  const ids = COMMON_EVM_CHAINS.map(chain => chain.chainId);
  assert.equal(COMMON_EVM_CHAINS.length >= 13, true);
  for (const id of [1, 8453, 42161, 10, 137, 56, 43114, 100, 59144, 534352, 324, 42220, 5000]) assert.equal(ids.includes(id), true);
  const base = COMMON_EVM_CHAINS.find(chain => chain.chainId === 8453);
  assert.equal(base.explorerBaseUrl, 'https://basescan.org');
  assert.equal(base.capabilities.nativeBalance, true);
  assert.equal(base.capabilities.erc20Enumeration, 'unsupported');
  assert.equal(base.rpcUrl, null);
  assert.equal(base.nativeDecimals, 18);
  assert.equal(COMMON_EVM_CHAINS.every(chain => chain.nativeDecimals === 18), true);
});

test('custom chain validation is fail-closed for ids, URLs and credentials', () => {
  assert.equal(validateCustomChain(input()).ok, true);
  assert.equal(validateCustomChain(input({ chainId: 1 })).ok, false);
  assert.equal(validateCustomChain(input(), [900001]).ok, false);
  assert.equal(validateCustomChain(input({ chainId: 0 })).ok, false);
  assert.equal(validateCustomChain(input({ name: '' })).ok, false);
  assert.equal(validateCustomChain(input({ nativeDecimals: 6 })).value.nativeDecimals, 6);
  assert.equal(validateCustomChain(input({ nativeDecimals: 8 })).value.nativeDecimals, 8);
  for (const nativeDecimals of [-1, 37, 1.5, '18', null]) assert.equal(validateCustomChain(input({ nativeDecimals })).ok, false);
  assert.equal(validateCustomChain(input()).value.nativeDecimals, 18);
  assert.equal(validateCustomChain(input({ rpcUrl: '' })).ok, false);
  assert.equal(validateCustomChain(input({ rpcUrl: 'not-a-url' })).ok, false);
  assert.equal(validateCustomChain(input({ rpcUrl: 'http://localhost:8545' })).ok, false);
  assert.equal(validateCustomChain(input({ rpcUrl: 'http://localhost:8545' }), [], true).ok, true);
  assert.equal(validateCustomChain(input({ rpcUrl: 'http://127.0.0.1:8545' }), [], true).ok, true);
  assert.equal(validateCustomChain(input({ rpcUrl: 'http://[::1]:8545' }), [], true).ok, true);
  for (const host of ['https://192.168.1.10', 'https://100.64.0.1', 'https://198.18.0.1', 'https://rpc.localhost', 'https://rpc.local', 'https://[::1]', 'https://[fe80::1]']) assert.equal(validateCustomChain(input({ rpcUrl: host })).ok, false);
  assert.equal(validateCustomChain(input({ rpcUrl: 'http://remote.invalid' }), [], true).ok, false);
  const credentialUrl = ['https://', 'user', ':', 'synthetic', '@rpc.synthetic.invalid'].join('');
  assert.equal(validateCustomChain(input({ rpcUrl: credentialUrl })).ok, false);
  const queryUrl = `${'https://'}rpc.synthetic.invalid/?${'api'}${'Key'}=${'synthetic'}`;
  assert.equal(validateCustomChain(input({ explorerBaseUrl: queryUrl })).ok, false);
  assert.equal(validateCustomChain(input({ explorerBaseUrl: 'http://localhost:3000' }), [], true).ok, true);
  assert.equal(validateEndpointUrl(`${'https://'}rpc.synthetic.invalid/${'v2'}/${'a'.repeat(32)}`, false)?.code, 'credential-url');
  assert.equal(validateEndpointUrl(`${'https://'}rpc.synthetic.invalid/${'v3'}/${'a'.repeat(32)}`, false)?.code, 'credential-url');
  assert.equal(validateEndpointUrl(`${'https://'}rpc.synthetic.invalid/${'a'.repeat(10)}${'9'.repeat(12)}`, false)?.code, 'credential-url');
  assert.equal(validateEndpointUrl(`${'https://'}rpc.synthetic.invalid/${'a'.repeat(24)}`, false)?.code, 'credential-url');
  assert.equal(validateEndpointUrl('https://rpc.synthetic.invalid/v2/chain', false), null);
});

test('chain resolver applies safe built-in and custom RPC overrides and enabled ids', () => {
  const resolved = resolveChains({
    customChains: [input({ chainId: 900010, name: 'Resolved Synthetic', nativeDecimals: 6 })],
    rpcOverrides: [{ chainId: 1, rpcUrl: 'https://rpc.ethereum.synthetic' }, { chainId: 900010, rpcUrl: 'https://rpc.custom.synthetic' }, { chainId: 8453, rpcUrl: `${'https://'}rpc.synthetic.invalid/${'v2'}/${'a'.repeat(32)}` }],
    enabledChainIds: [1, 900010]
  });
  assert.deepEqual(resolved.map(chain => chain.chainId), [1, 900010]);
  assert.equal(resolved[0].rpcUrl, 'https://rpc.ethereum.synthetic');
  assert.equal(resolved[1].rpcUrl, 'https://rpc.custom.synthetic');
  assert.equal(resolved[1].nativeDecimals, 6);
  const all = resolveChains({ customChains: [input({ chainId: 1 }), input({ chainId: 900011 })], rpcOverrides: [], enabledChainIds: [] });
  assert.equal(all.some(chain => chain.chainId === 900011), true);
  assert.equal(all.find(chain => chain.chainId === 1).builtin, true);
});

test('custom chain registry supports add/edit/delete without touching built-ins', () => {
  const registry = createChainRegistry();
  assert.equal(registry.list().length, COMMON_EVM_CHAINS.length);
  const added = registry.add(input());
  assert.equal(added.ok, true);
  assert.equal(registry.list().length, COMMON_EVM_CHAINS.length + 1);
  assert.equal(registry.add(input({ chainId: 900003 })).ok, true);
  assert.equal(registry.add(input()).ok, false);
  assert.equal(registry.update(1, input()).ok, false);
  assert.equal(registry.update(999999, input()).ok, false);
  const edited = registry.update(900001, input({ chainId: 900002, name: 'Edited Synthetic' }));
  assert.equal(edited.ok, true);
  assert.equal(registry.update(900002, input({ chainId: 1 })).ok, false);
  assert.equal(registry.update(900002, input({ rpcUrl: '' })).ok, false);
  assert.equal(registry.remove(1).ok, false);
  assert.equal(registry.remove(999999).ok, false);
  assert.equal(registry.remove(900002).ok, true);
  assert.equal(registry.remove(900003).ok, true);
  assert.equal(registry.list().length, COMMON_EVM_CHAINS.length);
});
