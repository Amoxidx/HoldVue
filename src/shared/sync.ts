import { createHash } from 'node:crypto';
import type { IdFactory, PortfolioState, Position, WalletSource, WalletSyncStatus, SyncStatusCode } from './state.ts';
import { parsePortfolioState } from './state.ts';
import type { AdapterContext, AdapterScanResult, WalletAdapter } from './adapters.ts';
import type { PricingCoordinator } from './pricing.ts';

export interface SyncDependencies {
  readonly adapters: readonly WalletAdapter[];
  readonly adapterFactory?: (state: PortfolioState) => readonly WalletAdapter[];
  readonly ids: IdFactory;
  readonly now: () => number;
  readonly maxConcurrency?: number;
  readonly pricing?: PricingCoordinator;
}

export interface SyncRun {
  readonly state: PortfolioState;
  readonly results: readonly AdapterScanResult[];
}

export interface SyncRunOptions {
  readonly scanWallets?: boolean;
}

export interface SyncCoordinator {
  run(state: PortfolioState, context: Omit<AdapterContext, 'now'>, options?: SyncRunOptions): Promise<SyncRun>;
  stop(): void;
  active(): number;
}

function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
const contextIds = new WeakMap<object, number>();
let nextContextId = 1;
function identity(value: unknown): number {
  if (typeof value !== 'object' || value === null) return 0;
  const existing = contextIds.get(value);
  if (existing !== undefined) return existing;
  const id = nextContextId++;
  contextIds.set(value, id);
  return id;
}
function statusFor(result: AdapterScanResult): SyncStatusCode { return result.status; }
function providerEnabled(state: PortfolioState, providerId: string): boolean {
  return state.settings.enabledProviderIds.includes(providerId);
}

function disabledResult(wallet: WalletSource, providerId: string): AdapterScanResult {
  return { family: wallet.family, providerId, status: 'unconfigured', capability: 'token-discovery-unavailable', positions: [], errorCode: 'provider-disabled' };
}

function adapterFor(adapters: readonly WalletAdapter[], wallet: WalletSource): WalletAdapter | undefined {
  return adapters.find(adapter => adapter.family === wallet.family);
}

function toPosition(wallet: WalletSource, draft: AdapterScanResult['positions'][number], now: number, id: string): Position {
  const quantity = formatDraftQuantity(draft.baseUnits, draft.decimals);
  return { schemaVersion: 3, id, walletId: wallet.id, family: draft.family, chainId: draft.chainId, assetKind: draft.assetKind, assetId: draft.assetId, symbol: draft.symbol, ...(draft.assetName ? { assetName: draft.assetName } : {}), baseUnits: draft.baseUnits, quantity, confirmedBaseUnits: draft.confirmedBaseUnits ?? draft.baseUnits, pendingBaseUnits: draft.pendingBaseUnits ?? '0', decimals: draft.decimals, updatedAt: now, spam: draft.assetKind === 'native' ? null : draft.spam ?? null };
}

function formatDraftQuantity(baseUnits: string, decimals: number): string {
  if (decimals === 0) return baseUnits;
  const padded = baseUnits.padStart(decimals + 1, '0');
  const split = padded.length - decimals;
  const fraction = padded.slice(split).replace(/0+$/, '');
  return fraction === '' ? padded.slice(0, split) : `${padded.slice(0, split)}.${fraction}`;
}

function replacePositions(state: PortfolioState, wallet: WalletSource, result: AdapterScanResult, now: number, ids: IdFactory): readonly Position[] {
  const old = state.positions.filter(position => position.walletId !== wallet.id);
  const retained = state.positions.filter(position => position.walletId === wallet.id && result.status === 'partial' && result.positions.every(draft => `${draft.chainId ?? 'none'}:${draft.assetKind}:${draft.assetId}` !== `${position.chainId ?? 'none'}:${position.assetKind}:${position.assetId}`));
  const next = result.positions.map(draft => toPosition(wallet, draft, now, ids.next()));
  return [...old, ...retained, ...next];
}

function statusRecord(wallet: WalletSource, result: AdapterScanResult, attemptedAt: number, previous: readonly WalletSyncStatus[]): WalletSyncStatus {
  const prior = previous.find(item => item.walletId === wallet.id && item.providerId === result.providerId);
  const successful = result.status === 'ok' || result.status === 'empty' || result.status === 'partial';
  return { walletId: wallet.id, family: wallet.family, providerId: result.providerId, status: statusFor(result), lastAttemptAt: attemptedAt, lastSuccessAt: successful ? attemptedAt : prior?.lastSuccessAt ?? null, errorCode: result.errorCode };
}

interface QueueEntry<T> { readonly task: () => Promise<T>; readonly resolve: (value: T) => void; readonly reject: (error: unknown) => void; }
function createLimiter(limit: number): { run<T>(task: () => Promise<T>): Promise<T>; active(): number; stop(): void } {
  const max = Number.isSafeInteger(limit) && limit > 0 ? limit : 1;
  const queue: QueueEntry<unknown>[] = [];
  let active = 0;
  let stopped = false;
  const pump = (): void => {
    while (!stopped && active < max && queue.length > 0) {
      const entry = queue.shift()!;
      active++;
      void Promise.resolve().then(entry.task).then(entry.resolve, entry.reject).finally(() => { active--; pump(); });
    }
  };
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => { queue.push({ task, resolve: value => resolve(value as T), reject }); pump(); });
    },
    active: () => active,
    stop: () => { stopped = true; while (queue.length > 0) queue.shift()!.reject(new Error('stopped')); }
  };
}

export function reconcileSync(state: PortfolioState, wallet: WalletSource, result: AdapterScanResult, now: number, ids: IdFactory): PortfolioState {
  const nextPositions = result.status === 'ok' || result.status === 'empty' || result.status === 'partial' ? replacePositions(state, wallet, result, now, ids) : state.positions;
  const status = statusRecord(wallet, result, now, state.sync.statuses);
  const statuses = [...state.sync.statuses.filter(item => !(item.walletId === wallet.id && item.providerId === result.providerId)), status];
  return parsePortfolioState({ ...state, positions: nextPositions, sync: { schemaVersion: 1, statuses } });
}

export function createSyncCoordinator(dependencies: SyncDependencies): SyncCoordinator {
  const limiter = createLimiter(dependencies.maxConcurrency ?? 2);
  const inFlight = new Map<string, Promise<SyncRun>>();
  const stopController = new AbortController();
  let stopped = false;
  const run = (state: PortfolioState, context: Omit<AdapterContext, 'now'>, options?: SyncRunOptions): Promise<SyncRun> => {
    if (stopped) return Promise.reject(new Error('stopped'));
    const scanWallets = options?.scanWallets !== false;
    const key = hash(JSON.stringify({ wallets: state.wallets, settings: state.settings, scanWallets, context: { http: identity(context.http), rpc: identity(context.rpc), secrets: identity(context.secrets), signal: identity(context.signal) } }));
    const existing = inFlight.get(key);
    if (existing) return existing;
    const task = (async (): Promise<SyncRun> => {
      let next = parsePortfolioState(state);
      const wallets = scanWallets ? next.wallets.filter(wallet => wallet.enabled) : [];
      const adapters = scanWallets ? dependencies.adapterFactory?.(next) ?? dependencies.adapters : [];
      const results = wallets.map(() => undefined as unknown as AdapterScanResult);
      await Promise.all(wallets.map((wallet, index) => limiter.run(async () => {
        const adapter = adapterFor(adapters, wallet);
        const providerId = adapter?.providerId ?? `${wallet.family}.unsupported`;
        const controller = new AbortController();
        const abort = (): void => controller.abort();
        stopController.signal.addEventListener('abort', abort, { once: true });
        context.signal?.addEventListener('abort', abort, { once: true });
        if (context.signal?.aborted) controller.abort();
        try {
          const attempt = providerEnabled(next, providerId) && adapter ? await adapter.scan({ ...wallet }, { ...context, signal: controller.signal, settings: next.settings, now: dependencies.now() }) : disabledResult(wallet, providerId);
          results[index] = attempt;
        } catch (error) {
          results[index] = { family: wallet.family, providerId, status: error instanceof Error && error.message === 'stopped' ? 'aborted' : 'error', capability: 'native-complete', positions: [], errorCode: error instanceof Error && error.message === 'stopped' ? 'aborted' : 'scan-failed' };
        } finally {
          stopController.signal.removeEventListener('abort', abort);
          context.signal?.removeEventListener('abort', abort);
        }
      })));
      for (let index = 0; index < wallets.length; index++) next = reconcileSync(next, wallets[index]!, results[index]!, dependencies.now(), dependencies.ids);
      if (dependencies.pricing && context.http) {
        try { next = (await dependencies.pricing.run(next, { http: context.http, signal: context.signal })).state; } catch (error) {
          if (error instanceof Error && error.message === 'stopped') throw error;
        }
      }
      return { state: next, results };
    })().finally(() => { if (inFlight.get(key) === task) inFlight.delete(key); });
    inFlight.set(key, task);
    return task;
  };
  return { run, stop: () => { stopped = true; stopController.abort(); limiter.stop(); dependencies.pricing?.stop(); }, active: () => limiter.active() };
}
