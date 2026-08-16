export interface HttpRequest {
  readonly url: string;
  readonly method?: 'GET' | 'POST';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly development?: boolean;
  /** Only fixed official provider adapters may set this for public address paths. */
  readonly allowPublicPath?: boolean;
  /** Secret query values are appended inside transport and never persisted/logged. */
  readonly secretQuery?: Readonly<Record<string, string>>;
}

export interface HttpResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly redirected?: boolean;
  readonly body?: AsyncIterable<Uint8Array | string> | { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel?(): Promise<void> } };
  text(): Promise<string>;
}

export interface HttpJsonPort {
  requestJson<T>(request: HttpRequest, signal?: AbortSignal): Promise<T>;
}

export interface FetchInit {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal: AbortSignal;
  readonly redirect: 'manual';
}

export type FetchLike = (url: string, init: FetchInit) => Promise<HttpResponseLike>;
export type TransportErrorCode = 'invalid-url' | 'invalid-options' | 'timeout' | 'aborted' | 'http' | 'redirect' | 'too-large' | 'invalid-json' | 'network';

export class TransportError extends Error {
  public readonly code: TransportErrorCode;
  public readonly status: number | null;
  public constructor(code: TransportErrorCode, message: string, status: number | null = null) {
    super(message); this.name = 'TransportError'; this.code = code; this.status = status;
  }
}

function isLocalHost(hostname: string): boolean { return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'; }
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return /^(?:localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host) || host.endsWith('.localhost') || host.endsWith('.local') || /^(?:\[?::1\]?|fc|fd|fe80:)/.test(host);
}

function credentialPath(url: URL): boolean {
  const segments = url.pathname.split('/').filter(Boolean);
  return segments.some((segment, index) => {
    const previous = segments[index - 1]?.toLowerCase();
    const versionSecret = (previous === 'v2' || previous === 'v3') && segment.length >= 8;
    const highEntropy = segment.length >= 20 && /[a-z]/i.test(segment) && /[0-9]/.test(segment);
    const longCredential = segment.length >= 24 && /^[A-Za-z0-9_-]+$/.test(segment);
    return versionSecret || highEntropy || longCredential;
  });
}

function validateRequestUrl(value: string, development: boolean, allowPublicPath: boolean): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new TransportError('invalid-url', 'Network URL is invalid.'); }
  if (url.username !== '' || url.password !== '' || (!allowPublicPath && credentialPath(url)) || [...url.searchParams.keys()].some(key => /(?:key|token|secret|auth|credential)/i.test(key))) throw new TransportError('invalid-url', 'Credentials are not allowed in network URLs.');
  if (isPrivateHost(url.hostname) && !(development && isLocalHost(url.hostname))) throw new TransportError('invalid-url', 'Private network URLs are not allowed.');
  if (url.protocol !== 'https:' && !(development && url.protocol === 'http:' && isLocalHost(url.hostname))) throw new TransportError('invalid-url', 'Only HTTPS or development localhost URLs are allowed.');
}

function validatePositiveOption(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new TransportError('invalid-options', 'Network request limits must be positive safe integers.');
  return value;
}

async function readResponseText(response: HttpResponseLike, maxBytes: number): Promise<string> {
  const body = response.body;
  if (body && typeof body === 'object' && 'getReader' in body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value = chunk.value ?? new Uint8Array();
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel?.(); throw new TransportError('too-large', 'Network response exceeded the configured size limit.'); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  }
  if (body && typeof body === 'object' && Symbol.asyncIterator in body) {
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = '';
    for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
      const value = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new TransportError('too-large', 'Network response exceeded the configured size limit.');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new TransportError('too-large', 'Network response exceeded the configured size limit.');
  return text;
}

export function createFetchTransport(fetchImpl: FetchLike = (url, init) => fetch(url, init as RequestInit) as Promise<HttpResponseLike>): HttpJsonPort {
  return {
    async requestJson<T>(request: HttpRequest, signal?: AbortSignal): Promise<T> {
      validateRequestUrl(request.url, request.development === true, request.allowPublicPath === true);
      const timeoutMs = validatePositiveOption(request.timeoutMs, 30_000);
      const maxBytes = validatePositiveOption(request.maxBytes, 1_000_000);
      const controller = new AbortController();
      let timedOut = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const abort = (): void => controller.abort();
      if (signal?.aborted) throw new TransportError('aborted', 'Network request was aborted.');
      if (signal) signal.addEventListener('abort', abort, { once: true });
      timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      const cleanup = (): void => {
        if (timeout !== undefined) clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
      };
      let result!: T;
      try {
        const headers = { ...(request.headers ?? {}) };
        const requestUrl = new URL(request.url);
        for (const [key, value] of Object.entries(request.secretQuery ?? {})) requestUrl.searchParams.set(key, value);
        const body = request.body === undefined ? undefined : JSON.stringify(request.body);
        if (body !== undefined && headers['content-type'] === undefined) headers['content-type'] = 'application/json';
        const response = await fetchImpl(requestUrl.toString(), { method: request.method ?? 'GET', headers, ...(body === undefined ? {} : { body }), signal: controller.signal, redirect: 'manual' });
        if (response.redirected || (response.status >= 300 && response.status < 400)) throw new TransportError('redirect', 'Network redirects are rejected.');
        if (!response.ok) throw new TransportError('http', 'Network provider returned an HTTP error.', response.status);
        const text = await readResponseText(response, maxBytes);
        try { result = JSON.parse(text) as T; } catch { throw new TransportError('invalid-json', 'Network provider returned invalid JSON.'); }
      } catch (error) {
        const mapped = error instanceof TransportError ? error : timedOut ? new TransportError('timeout', 'Network request timed out.') : signal?.aborted || controller.signal.aborted ? new TransportError('aborted', 'Network request was aborted.') : new TransportError('network', 'Network request failed.');
        cleanup();
        throw mapped;
      }
      cleanup();
      return result;
    }
  };
}
