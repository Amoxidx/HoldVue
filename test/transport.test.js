import assert from 'node:assert/strict';
import test from 'node:test';
import { createFetchTransport, TransportError } from '../src/shared/transport.ts';

function response(body, ok = true, status = 200) { return { ok, status, text: async () => body }; }

test('injected HTTP transport serializes JSON, bounds responses, and redacts failures', async () => {
  let seen;
  const transport = createFetchTransport(async (url, init) => { seen = { url, init }; return response('{"ok":true}'); });
  assert.deepEqual(await transport.requestJson({ url: 'https://rpc.synthetic.invalid', method: 'POST', body: { ping: true } }), { ok: true });
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['content-type'], 'application/json');
  const secretTransport = createFetchTransport(async (url, init) => { seen = { url, init }; return response('{"secretQuery":true}'); });
  assert.deepEqual(await secretTransport.requestJson({ url: 'https://rpc.synthetic.invalid/v2/api', secretQuery: { apikey: 'synthetic-secret' } }), { secretQuery: true });
  assert.match(seen.url, /[?&]apikey=synthetic-secret/);
  const get = createFetchTransport(async (_url, init) => { assert.equal(init.body, undefined); return response('[]'); });
  assert.deepEqual(await get.requestJson({ url: 'https://rpc.synthetic.invalid' }), []);
  const tooLarge = createFetchTransport(async () => response('12345'));
  await assert.rejects(tooLarge.requestJson({ url: 'https://rpc.synthetic.invalid', maxBytes: 3 }), error => error instanceof TransportError && error.code === 'too-large');
  const utf8TooLarge = createFetchTransport(async () => response('€'));
  await assert.rejects(utf8TooLarge.requestJson({ url: 'https://rpc.synthetic.invalid', maxBytes: 2 }), error => error instanceof TransportError && error.code === 'too-large');
  const invalidLimits = createFetchTransport(async () => response('{}'));
  await assert.rejects(invalidLimits.requestJson({ url: 'https://rpc.synthetic.invalid', timeoutMs: 0 }), error => error instanceof TransportError && error.code === 'invalid-options');
  await assert.rejects(invalidLimits.requestJson({ url: 'https://rpc.synthetic.invalid', maxBytes: Number.POSITIVE_INFINITY }), error => error instanceof TransportError && error.code === 'invalid-options');
  const invalidJson = createFetchTransport(async () => response('not-json'));
  await assert.rejects(invalidJson.requestJson({ url: 'https://rpc.synthetic.invalid' }), error => error instanceof TransportError && error.code === 'invalid-json');
  const httpError = createFetchTransport(async () => response('{}', false, 503));
  await assert.rejects(httpError.requestJson({ url: 'https://rpc.synthetic.invalid' }), error => error instanceof TransportError && error.code === 'http');
});

test('HTTP transport rejects unsafe URLs and supports only development localhost HTTP', async () => {
  const transport = createFetchTransport(async () => response('{}'));
  await assert.rejects(transport.requestJson({ url: 'not-a-url' }), error => error.code === 'invalid-url');
  await assert.rejects(transport.requestJson({ url: 'http://remote.invalid' }), error => error.code === 'invalid-url');
  for (const url of ['https://192.168.1.10', 'https://100.64.0.1', 'https://198.18.0.1', 'https://rpc.localhost', 'https://rpc.local', 'https://[::1]', 'https://[fe80::1]']) await assert.rejects(transport.requestJson({ url }), error => error.code === 'invalid-url');
  const credentialUrl = ['https://', 'user', ':', 'synthetic', '@rpc.synthetic.invalid'].join('');
  await assert.rejects(transport.requestJson({ url: credentialUrl }), error => error.code === 'invalid-url');
  const pathCredential = `${'https://'}rpc.synthetic.invalid/${'v2'}/${'a'.repeat(32)}`;
  await assert.rejects(transport.requestJson({ url: pathCredential }), error => error.code === 'invalid-url');
  const genericPathCredential = `${'https://'}rpc.synthetic.invalid/${'a'.repeat(10)}${'9'.repeat(12)}`;
  await assert.rejects(transport.requestJson({ url: genericPathCredential }), error => error.code === 'invalid-url');
  const longPathCredential = `${'https://'}rpc.synthetic.invalid/${'a'.repeat(24)}`;
  await assert.rejects(transport.requestJson({ url: longPathCredential }), error => error.code === 'invalid-url');
  const dev = createFetchTransport(async () => response('{"dev":true}'));
  assert.deepEqual(await dev.requestJson({ url: 'http://localhost:8545', development: true }), { dev: true });
  assert.deepEqual(await dev.requestJson({ url: 'http://127.0.0.1:8545', development: true }), { dev: true });
  assert.deepEqual(await dev.requestJson({ url: 'http://[::1]:8545', development: true }), { dev: true });
});

test('HTTP transport maps timeout, caller abort, and network errors to redacted codes', async () => {
  const timeout = createFetchTransport(async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('provider detail')))));
  await assert.rejects(timeout.requestJson({ url: 'https://rpc.synthetic.invalid', timeoutMs: 1 }), error => error.code === 'timeout' && !error.message.includes('provider'));
  const controller = new AbortController();
  const aborted = createFetchTransport(async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('provider detail')))));
  const pending = aborted.requestJson({ url: 'https://rpc.synthetic.invalid' }, controller.signal);
  controller.abort();
  await assert.rejects(pending, error => error.code === 'aborted');
  const already = new AbortController(); already.abort();
  await assert.rejects(aborted.requestJson({ url: 'https://rpc.synthetic.invalid' }, already.signal), error => error.code === 'aborted');
  const network = createFetchTransport(async () => { throw new Error('private network detail'); });
  await assert.rejects(network.requestJson({ url: 'https://rpc.synthetic.invalid' }), error => error.code === 'network' && !error.message.includes('private'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response('{"default":true}');
  try {
    assert.deepEqual(await createFetchTransport().requestJson({ url: 'https://rpc.synthetic.invalid' }), { default: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HTTP transport bounds streaming bodies before full buffering and rejects redirects', async () => {
  let cancelled = false;
  const reader = {
    index: 0,
    async read() { this.index++; return this.index === 1 ? { done: false, value: new TextEncoder().encode('{"ok":') } : this.index === 2 ? { done: false, value: new TextEncoder().encode('true}') } : { done: true }; },
    async cancel() { cancelled = true; }
  };
  const streamed = createFetchTransport(async () => ({ ok: true, status: 200, body: { getReader: () => reader }, text: async () => 'unused' }));
  assert.deepEqual(await streamed.requestJson({ url: 'https://rpc.synthetic.invalid', maxBytes: 20 }), { ok: true });
  let missingValueRead = 0;
  const missingValue = createFetchTransport(async () => ({ ok: true, status: 200, body: { getReader: () => ({ read: async () => { missingValueRead++; return missingValueRead === 1 ? { done: false } : missingValueRead === 2 ? { done: false, value: new TextEncoder().encode('{}') } : { done: true }; } }) }, text: async () => 'unused' }));
  assert.deepEqual(await missingValue.requestJson({ url: 'https://rpc.synthetic.invalid' }), {});
  const oversized = createFetchTransport(async () => ({ ok: true, status: 200, body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(4) }), cancel: async () => { cancelled = true; } }) }, text: async () => 'unused' }));
  await assert.rejects(oversized.requestJson({ url: 'https://rpc.synthetic.invalid', maxBytes: 3 }), error => error.code === 'too-large');
  assert.equal(cancelled, true);
  async function* chunks() { yield '{"chunk":"'; yield new Uint8Array([115, 121, 110, 116, 104, 101, 116, 105, 99, 34, 125]); }
  const iterable = createFetchTransport(async () => ({ ok: true, status: 200, body: chunks(), text: async () => 'unused' }));
  assert.deepEqual(await iterable.requestJson({ url: 'https://rpc.synthetic.invalid' }), { chunk: 'synthetic' });
  const tooLargeIterable = createFetchTransport(async () => ({ ok: true, status: 200, body: chunks(), text: async () => 'unused' }));
  await assert.rejects(tooLargeIterable.requestJson({ url: 'https://rpc.synthetic.invalid', maxBytes: 4 }), error => error.code === 'too-large');
  const redirect = createFetchTransport(async () => ({ ok: true, status: 302, redirected: false, text: async () => '{}' }));
  await assert.rejects(redirect.requestJson({ url: 'https://rpc.synthetic.invalid' }), error => error.code === 'redirect');
  const redirected = createFetchTransport(async () => ({ ok: true, status: 200, redirected: true, text: async () => '{}' }));
  await assert.rejects(redirected.requestJson({ url: 'https://rpc.synthetic.invalid' }), error => error.code === 'redirect');
});
