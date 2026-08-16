import { createHash } from 'node:crypto';
import type { EvmChain } from './chains.ts';
import type { EvmWalletSource, Settings, WalletFamily } from './state.ts';
import { TransportError } from './transport.ts';

export interface JsonRpcPort {
  call<T>(url: string, method: string, params: readonly unknown[], signal?: AbortSignal): Promise<T>;
}

export interface JsonRpcResponse<T> {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly result?: T;
  readonly error?: unknown;
}

export class RpcError extends Error {
  public constructor(message = 'JSON-RPC provider returned an error.') { super(message); this.name = 'RpcError'; }
}

export function createJsonRpcPort(transport: { requestJson<T>(request: { url: string; method: 'POST'; body: unknown; timeoutMs?: number; maxBytes?: number; development?: boolean }, signal?: AbortSignal): Promise<T> }, options: { readonly timeoutMs?: number; readonly maxBytes?: number; readonly development?: boolean } = {}): JsonRpcPort {
  let id = 0;
  return {
    async call<T>(url: string, method: string, params: readonly unknown[], signal?: AbortSignal): Promise<T> {
      const requestId = ++id;
      const response = await transport.requestJson<JsonRpcResponse<T>>({ url, method: 'POST', body: { jsonrpc: '2.0', id: requestId, method, params }, timeoutMs: options.timeoutMs, maxBytes: options.maxBytes, development: options.development }, signal);
      if (!response || response.jsonrpc !== '2.0' || response.id !== requestId || response.error !== undefined || !('result' in response)) throw new RpcError();
      return response.result as T;
    }
  };
}

export function parseHexQuantity(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) return null;
  return BigInt(value);
}

export function formatUnits(value: bigint, decimals: number): string {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) throw new RangeError('Decimals must be an integer from 0 through 36.');
  if (decimals === 0) return value.toString();
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
}

export interface NativeBalanceResult {
  readonly family: 'evm';
  readonly chainId: number;
  readonly asset: string;
  readonly decimals: number;
  readonly status: 'ok' | 'unconfigured' | 'error' | 'unsupported';
  readonly balanceWei: string | null;
  readonly quantity: string | null;
  readonly errorCode: string | null;
}

function errorCode(error: unknown): string { return error instanceof TransportError ? error.code : error instanceof RpcError ? 'rpc' : 'unknown'; }

export interface RpcWorkLimiter {
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  active(): number;
}

interface RpcQueueEntry<T> {
  readonly task: () => Promise<T>;
  readonly signal?: AbortSignal;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
  started: boolean;
  cancelled: boolean;
  onAbort?: () => void;
}

export function createRpcWorkLimiter(limit = 1): RpcWorkLimiter {
  const max = Number.isSafeInteger(limit) && limit > 0 ? limit : 1;
  const queue: RpcQueueEntry<unknown>[] = [];
  let running = 0;
  const aborted = (): TransportError => new TransportError('aborted', 'The scan was aborted before RPC work started.');
  const pump = (): void => {
    while (running < max && queue.length > 0) {
      const entry = queue.shift()!;
      if (entry.cancelled || entry.signal?.aborted) {
        if (!entry.cancelled) {
          entry.cancelled = true;
          entry.reject(aborted());
        }
        continue;
      }
      entry.started = true;
      if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort);
      running++;
      void Promise.resolve().then(() => entry.task()).then(entry.resolve, entry.reject).finally(() => { running--; pump(); });
    }
  };
  const run = <T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) return Promise.reject(aborted());
    return new Promise<T>((resolve, reject) => {
      const entry: RpcQueueEntry<T> = { task, signal, resolve, reject, started: false, cancelled: false };
      const onAbort = (): void => {
        if (entry.started || entry.cancelled) return;
        entry.cancelled = true;
        reject(aborted());
        pump();
      };
      entry.onAbort = onAbort;
      signal?.addEventListener('abort', onAbort, { once: true });
      queue.push(entry as RpcQueueEntry<unknown>);
      pump();
    });
  };
  return { run, active: () => running };
}

function unconfiguredResult(chain: EvmChain): NativeBalanceResult {
  return { family: 'evm', chainId: chain.chainId, asset: chain.nativeAsset, decimals: chain.nativeDecimals, status: 'unconfigured', balanceWei: null, quantity: null, errorCode: 'unconfigured' };
}

function errorResult(chain: EvmChain, error: unknown): NativeBalanceResult {
  return { family: 'evm', chainId: chain.chainId, asset: chain.nativeAsset, decimals: chain.nativeDecimals, status: 'error', balanceWei: null, quantity: null, errorCode: errorCode(error) };
}

export async function scanEvmNativeBalances(wallet: EvmWalletSource, chains: readonly EvmChain[], rpc: JsonRpcPort, signal?: AbortSignal, settings?: Pick<Settings, 'enabledChainIds'>, limiter?: RpcWorkLimiter): Promise<readonly NativeBalanceResult[]> {
  if (!wallet.enabled) return [];
  const selected = chains.filter(chain => (settings === undefined || settings.enabledChainIds.length === 0 || settings.enabledChainIds.includes(chain.chainId)) && (wallet.options.chainIds.includes(chain.chainId) || (wallet.options.autoScanCommonChains && chain.builtin)));
  return Promise.all(selected.map(async chain => {
    if (!chain.rpcUrl) return unconfiguredResult(chain);
    const work = async (): Promise<NativeBalanceResult> => {
      try {
        const providerChainId = parseHexQuantity(await rpc.call<string>(chain.rpcUrl!, 'eth_chainId', [], signal));
        if (providerChainId === null || providerChainId !== BigInt(chain.chainId)) return { family: 'evm', chainId: chain.chainId, asset: chain.nativeAsset, decimals: chain.nativeDecimals, status: 'error', balanceWei: null, quantity: null, errorCode: 'chain-mismatch' };
        const raw = await rpc.call<string>(chain.rpcUrl!, 'eth_getBalance', [wallet.address, 'latest'], signal);
        const wei = parseHexQuantity(raw);
        if (wei === null) return { family: 'evm', chainId: chain.chainId, asset: chain.nativeAsset, decimals: chain.nativeDecimals, status: 'error', balanceWei: null, quantity: null, errorCode: 'invalid-quantity' };
        return { family: 'evm', chainId: chain.chainId, asset: chain.nativeAsset, decimals: chain.nativeDecimals, status: 'ok', balanceWei: wei.toString(), quantity: formatUnits(wei, chain.nativeDecimals), errorCode: null };
      } catch (error) {
        return errorResult(chain, error);
      }
    };
    try {
      return limiter ? await limiter.run(work, signal) : await work();
    } catch (error) {
      return errorResult(chain, error);
    }
  }));
}

export type CapabilityName = 'erc20' | 'bitcoin' | 'solana' | 'cardano';
export interface CapabilityResult { readonly capability: CapabilityName; readonly status: 'unsupported' | 'unconfigured'; readonly reason: string; readonly includesNfts: false; }
export interface CapabilityAdapter { scan(signal?: AbortSignal): Promise<CapabilityResult>; }

export function unsupportedCapability(capability: CapabilityName, reason = 'No deterministic adapter is configured.'): CapabilityResult {
  return { capability, status: 'unsupported', reason, includesNfts: false };
}

export function unconfiguredCapability(capability: CapabilityName, reason = 'An explicit provider configuration is required.'): CapabilityResult {
  return { capability, status: 'unconfigured', reason, includesNfts: false };
}

export function createCapabilityAdapter(capability: CapabilityName, adapter?: CapabilityAdapter): CapabilityAdapter {
  return adapter ?? { scan: async () => unconfiguredCapability(capability) };
}

export interface SingleFlight {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  active(): number;
}

export interface ScanCoordinator {
  scan(wallet: EvmWalletSource, chains: readonly EvmChain[], rpc: JsonRpcPort, signal?: AbortSignal, settings?: Pick<Settings, 'enabledChainIds'>): Promise<readonly NativeBalanceResult[]>;
  active(): number;
}

function fingerprintPart(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function scanFingerprint(wallet: EvmWalletSource, chains: readonly EvmChain[], settings?: Pick<Settings, 'enabledChainIds'>): string {
  const enabled = settings?.enabledChainIds ?? [];
  const effectiveChains = chains
    .filter(chain => (enabled.length === 0 || enabled.includes(chain.chainId)) && (wallet.options.chainIds.includes(chain.chainId) || (wallet.options.autoScanCommonChains && chain.builtin)))
    .map(chain => ({ chainId: chain.chainId, rpcUrl: chain.rpcUrl, nativeAsset: chain.nativeAsset, nativeDecimals: chain.nativeDecimals, builtin: chain.builtin }));
  return fingerprintPart(JSON.stringify({ wallet: { id: wallet.id, family: wallet.family, address: wallet.address, enabled: wallet.enabled, options: wallet.options }, chains: effectiveChains, enabled }));
}

const rpcIds = new WeakMap<object, number>();
let nextRpcId = 1;
function rpcIdentity(rpc: JsonRpcPort): number {
  const existing = rpcIds.get(rpc as object);
  if (existing !== undefined) return existing;
  const id = nextRpcId++;
  rpcIds.set(rpc as object, id);
  return id;
}

interface QueueEntry<T> { readonly key: string; readonly task: () => Promise<T>; readonly resolve: (value: T) => void; readonly reject: (reason: unknown) => void; }

export function createSingleFlight(limit = 1): SingleFlight {
  const max = Number.isSafeInteger(limit) && limit > 0 ? limit : 1;
  const inFlight = new Map<string, Promise<unknown>>();
  const queue: QueueEntry<unknown>[] = [];
  let running = 0;
  const pump = (): void => {
    while (running < max && queue.length > 0) {
      const entry = queue.shift()!;
      running++;
      void Promise.resolve().then(() => entry.task()).then(entry.resolve, entry.reject).finally(() => { running--; inFlight.delete(entry.key); pump(); });
    }
  };
  const run = <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const existing = inFlight.get(key);
    if (existing) return existing as Promise<T>;
    const promise = new Promise<T>((resolve, reject) => queue.push({ key, task: async () => task(), resolve: value => resolve(value as T), reject }));
    inFlight.set(key, promise);
    pump();
    return promise;
  };
  return { run, active: () => running };
}

export function createScanCoordinator(limit = 1): ScanCoordinator {
  const limiter = createRpcWorkLimiter(limit);
  const inFlight = new Map<string, Promise<readonly NativeBalanceResult[]>>();
  const scan = (wallet: EvmWalletSource, chains: readonly EvmChain[], rpc: JsonRpcPort, signal?: AbortSignal, settings?: Pick<Settings, 'enabledChainIds'>): Promise<readonly NativeBalanceResult[]> => {
    const signalId = signal ? rpcIdentity(signal as unknown as JsonRpcPort) : 0;
    const key = `${rpcIdentity(rpc)}:${signalId}:${scanFingerprint(wallet, chains, settings)}`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = scanEvmNativeBalances(wallet, chains, rpc, signal, settings, limiter).finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
  };
  return {
    scan,
    active: () => limiter.active()
  };
}

export type ScannerFamily = WalletFamily;
