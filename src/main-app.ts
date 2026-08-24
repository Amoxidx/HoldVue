import type { StateStorage } from './shared/storage.ts';
import type { MinuteScheduler } from './shared/scheduler.ts';
import { addHolding, addWallet, createProviderReference, deleteHolding, deleteWallet, parsePortfolioState, updateHolding, updateSettings, updateWallet, type Clock, type HoldingResult, type IdFactory, type InstrumentInput, type PortfolioState, type Settings, type WalletFamily, type WalletInput, type WalletResult } from './shared/state.ts';
import { detectAddress, type AddressDetection } from './shared/addresses.ts';
import type { AdapterContext } from './shared/adapters.ts';
import type { SyncCoordinator } from './shared/sync.ts';
import type { SecretStore } from './shared/secrets.ts';
import type { InstrumentCandidate, InstrumentSearchResult } from './shared/market.ts';

export interface BrowserWindowLike {
  readonly webContents: {
    send(channel: string): void;
    setWindowOpenHandler(handler: (details: { readonly url: string }) => { readonly action: 'deny' }): void;
    on(event: 'will-navigate', callback: (event: { preventDefault(): void }) => void): void;
  };
  loadFile(filename: string): void | Promise<void>;
  on(event: 'closed', callback: () => void): void;
  isDestroyed(): boolean;
}

export interface BrowserWindowConstructor {
  new (options: Record<string, unknown>): BrowserWindowLike;
  getAllWindows(): readonly BrowserWindowLike[];
}

export interface AppLike {
  readonly name?: string;
  setName?(name: string): void;
  whenReady(): Promise<void>;
  on(event: 'activate' | 'window-all-closed', callback: () => void): void;
  quit(): void;
  getPath(name: 'userData'): string;
}

export interface IpcMainLike {
  handle(channel: string, handler: (...args: readonly unknown[]) => unknown): void;
}

export interface ClipboardPort {
  writeText(value: string): void | Promise<void>;
}

export interface ExternalBrowserPort {
  openExternal(url: string): void | Promise<void>;
}

export interface WalletAddRequest {
  readonly label: string;
  readonly family: WalletFamily;
  readonly address: string;
  readonly enabled?: boolean;
  readonly options?: WalletInput['options'];
}

export interface WalletEditRequest {
  readonly label?: string;
  readonly family?: WalletFamily;
  readonly address?: string;
  readonly enabled?: boolean;
  readonly options?: WalletInput['options'];
}

export interface PublicSuccess<T> { readonly ok: true; readonly value: T; }
export interface PublicFailure { readonly ok: false; readonly code: string; readonly message: string; }
export type PublicResult<T> = PublicSuccess<T> | PublicFailure;
export interface CopyWalletSuccess { readonly copied: true; }

export interface HoldingAddRequest { readonly instrument: InstrumentCandidate; readonly quantity: string; }
export interface HoldingEditRequest { readonly quantity?: string; readonly instrument?: InstrumentCandidate; }
export interface InstrumentSearchPort {
  search(query: string, signal?: AbortSignal): Promise<InstrumentSearchResult>;
  resolve?(candidate: InstrumentCandidate, signal?: AbortSignal): Promise<InstrumentInput | { readonly ok: false; readonly code: string; readonly message: string }>;
}

export interface MainCompositionOptions {
  readonly app: AppLike;
  readonly BrowserWindow: BrowserWindowConstructor;
  readonly ipcMain: IpcMainLike;
  readonly storage: StateStorage;
  readonly scheduler: MinuteScheduler;
  readonly clipboard?: ClipboardPort;
  readonly shell?: ExternalBrowserPort;
  readonly secrets?: SecretStore;
  readonly instrumentSearch?: InstrumentSearchPort;
  readonly ids: IdFactory;
  readonly clock: Clock;
  readonly paths: { readonly preload: string; readonly renderer: string; readonly icon?: string };
  readonly platform: string;
  readonly sync?: { readonly coordinator: SyncCoordinator; readonly context?: Omit<AdapterContext, 'now'> };
}

export interface MainComposition {
  start(): Promise<void>;
  stop(): void;
  emitMinute(): void;
  getWindow(): BrowserWindowLike | null;
}

export function createMainComposition(options: MainCompositionOptions): MainComposition {
  let windowRef: BrowserWindowLike | null = null;
  let registered = false;
  let startPromise: Promise<void> | null = null;
  let mutationQueue: Promise<void> = Promise.resolve();
  let refreshPromise: Promise<PublicResult<PortfolioState>> | null = null;
  let searchController: AbortController | null = null;

  const failure = (code: string, message: string): PublicFailure => ({ ok: false, code, message });
  const requestPayload = (args: readonly unknown[]): unknown => args.length > 1 ? args[1] : args[0];
  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
  const containsForbiddenField = (value: unknown, seen = new Set<object>()): boolean => {
    if (typeof value !== 'object' || value === null) return false;
    if (seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.some(item => containsForbiddenField(item, seen));
    return Object.entries(value).some(([key, item]) => /(?:private|secret|seed|mnemonic|passphrase|credential|token|api[_-]?key|access[_-]?key|authorization)/i.test(key) || containsForbiddenField(item, seen));
  };
  const asWalletAdd = (value: unknown): WalletInput | null => {
    if (!isRecord(value)) return null;
    if (value.options !== undefined && !isRecord(value.options)) return null;
    return {
      label: value.label as string,
      family: value.family as WalletFamily,
      address: value.address as string,
      enabled: value.enabled as boolean | undefined,
      options: isRecord(value.options) ? value.options : undefined
    };
  };
  const asWalletEdit = (value: unknown): Partial<WalletInput> | null => {
    if (!isRecord(value)) return null;
    if (value.options !== undefined && !isRecord(value.options)) return null;
    const result: Partial<WalletInput> = {};
    if (value.label !== undefined) (result as Record<string, unknown>).label = value.label;
    if (value.family !== undefined) (result as Record<string, unknown>).family = value.family;
    if (value.address !== undefined) (result as Record<string, unknown>).address = value.address;
    if (value.enabled !== undefined) (result as Record<string, unknown>).enabled = value.enabled;
    if (value.options !== undefined) (result as Record<string, unknown>).options = value.options;
    return result;
  };
  const asInstrument = (value: unknown): InstrumentCandidate | null => {
    if (!isRecord(value)) return null;
    if (typeof value.providerId !== 'string' || typeof value.providerSymbol !== 'string' || typeof value.symbol !== 'string' || typeof value.name !== 'string' || typeof value.exchange !== 'string' || typeof value.currency !== 'string' || (value.type !== 'stock' && value.type !== 'etf' && value.type !== 'unknown')) return null;
    return { providerId: value.providerId, providerSymbol: value.providerSymbol, symbol: value.symbol, name: value.name, exchange: value.exchange, currency: value.currency, type: value.type };
  };
  const asHoldingAdd = (value: unknown): HoldingAddRequest | null => {
    if (!isRecord(value) || typeof value.quantity !== 'string') return null;
    const instrument = asInstrument(value.instrument);
    return instrument ? { instrument, quantity: value.quantity } : null;
  };
  const asHoldingEdit = (value: unknown): HoldingEditRequest | null => {
    if (!isRecord(value)) return null;
    if (value.quantity !== undefined && typeof value.quantity !== 'string') return null;
    if (value.instrument === undefined) return value.quantity === undefined ? {} : { quantity: value.quantity as string };
    const instrument = asInstrument(value.instrument);
    return instrument ? { instrument, quantity: value.quantity as string | undefined } : null;
  };
  const publicWalletResult = (result: Extract<WalletResult<PortfolioState> | PublicFailure, { readonly ok: false }>): PublicFailure => failure(result.code, result.message);
  const enqueueMutation = <T>(task: () => Promise<T>): Promise<T> => {
    const next = mutationQueue.then(task, task);
    mutationQueue = next.then(() => undefined, () => undefined);
    return next;
  };
  const rejectedMutation = <T>(code: string, message: string): Promise<PublicResult<T>> => enqueueMutation(async () => failure(code, message));
  const loadState = async (): Promise<PortfolioState> => parsePortfolioState(await options.storage.load());
  const providerForFamily: Record<WalletFamily, string> = { evm: 'evm', bitcoin: 'bitcoin.mempool', solana: 'solana.rpc', cardano: 'cardano.koios' };
  const enableOnboardingProvider = (state: PortfolioState, family: WalletFamily): PortfolioState => updateSettings(state, { enabledProviderIds: [...new Set([...state.settings.enabledProviderIds, providerForFamily[family]])] });
  const mutateWallet = (task: (state: PortfolioState) => WalletResult<PortfolioState> | PublicFailure): Promise<PublicResult<PortfolioState>> => enqueueMutation(async () => {
    try {
      const current = await loadState();
      const result = task(current);
      if (!result.ok) return publicWalletResult(result);
      const next = { ...result.value, instruments: current.instruments, holdings: current.holdings };
      await options.storage.save(next);
      return { ok: true, value: next };
    } catch {
      return failure('storage-failed', 'Local state could not be updated.');
    }
  });
  const mutateHolding = (task: (state: PortfolioState) => HoldingResult<PortfolioState> | PublicFailure): Promise<PublicResult<PortfolioState>> => enqueueMutation(async () => {
    try {
      const result = task(await loadState());
      if (!result.ok) return failure(result.code, result.message);
      await options.storage.save(result.value);
      return result;
    } catch { return failure('storage-failed', 'Local state could not be updated.'); }
  });
  const resolveInstrument = async (candidate: InstrumentCandidate): Promise<InstrumentInput | PublicFailure> => {
    if (!options.instrumentSearch?.resolve) return failure('unsupported', 'The selected instrument could not be classified safely.');
    try {
      const resolved = await options.instrumentSearch.resolve(candidate);
      if ('ok' in resolved && resolved.ok === false) return failure(resolved.code, resolved.message);
      return resolved;
    } catch { return failure('search-failed', 'Instrument search failed.'); }
  };
  const mutateSettings = (patch: Partial<Omit<Settings, 'schemaVersion'>>): Promise<PublicResult<PortfolioState>> => enqueueMutation(async () => {
    try {
      const next = updateSettings(await loadState(), patch);
      await options.storage.save(next);
      if (next.settings.schedulerEnabled) options.scheduler.start();
      else options.scheduler.stop();
      return { ok: true, value: next };
    } catch {
      return failure('storage-failed', 'Local state could not be updated.');
    }
  });
  const mutateProviderKey = (providerId: string, value: unknown, remove: boolean): Promise<PublicResult<PortfolioState>> => enqueueMutation(async () => {
    if (!options.secrets) return failure('secret-storage-unavailable', 'Encrypted provider storage is unavailable.');
    if (!remove && (typeof value !== 'string' || value.length === 0 || value.length > 4096)) return failure('invalid-input', 'Provider key is invalid.');
    try {
      const current = await loadState();
      const existing = current.settings.providerRefs.find(reference => reference.providerId === providerId);
      if (remove) {
        const previous = existing?.keyId ? options.secrets.get(existing.keyId) : { ok: true as const, value: null };
        if (!previous.ok) return failure('secret-storage-failed', 'Encrypted provider storage failed.');
        if (existing?.keyId) {
          const deleted = options.secrets.delete(existing.keyId);
          if (!deleted.ok) return failure('secret-storage-failed', 'Encrypted provider storage failed.');
        }
        const next = updateSettings(current, { providerRefs: current.settings.providerRefs.filter(reference => reference.providerId !== providerId) });
        try { await options.storage.save(next); } catch {
          if (existing?.keyId) {
            if (previous.value === null) options.secrets.delete(existing.keyId);
            else options.secrets.set(existing.keyId, previous.value);
          }
          return failure('storage-failed', 'Local state could not be updated.');
        }
        return { ok: true, value: next };
      }
      const reference = existing ?? createProviderReference(providerId, options.ids);
      if (!reference?.keyId) return failure('invalid-input', 'Provider key could not be configured.');
      const previous = existing?.keyId ? options.secrets.get(existing.keyId) : { ok: true as const, value: null };
      if (!previous.ok) return failure('secret-storage-failed', 'Encrypted provider storage failed.');
      const stored = options.secrets.set(reference.keyId, value as string);
      if (!stored.ok) return failure('secret-storage-failed', 'Encrypted provider storage failed.');
      const refs = [...current.settings.providerRefs.filter(item => item.providerId !== providerId), { ...reference, enabled: true }];
      const next = updateSettings(current, { providerRefs: refs });
      try { await options.storage.save(next); } catch {
        if (previous.value === null) options.secrets.delete(reference.keyId);
        else options.secrets.set(reference.keyId, previous.value);
        return failure('storage-failed', 'Local state could not be updated.');
      }
      return { ok: true, value: next };
    } catch { return failure('storage-failed', 'Local state could not be updated.'); }
  });
  const refresh = (): Promise<PublicResult<PortfolioState>> => {
    if (!options.sync) return Promise.resolve(failure('unconfigured', 'No wallet providers are configured.'));
    if (refreshPromise) return refreshPromise;
    const pending = enqueueMutation(async () => {
      try {
        const state = await loadState();
        const run = await options.sync!.coordinator.run(state, options.sync!.context ?? {});
        await options.storage.save(run.state);
        if (windowRef && !windowRef.isDestroyed()) windowRef.webContents.send('holdvue:minute');
        return { ok: true as const, value: run.state };
      } catch (error) {
        return failure(error instanceof Error && error.message === 'stopped' ? 'aborted' : 'sync-failed', 'Wallet synchronization did not complete.');
      }
    }).finally(() => { refreshPromise = null; });
    refreshPromise = pending;
    return pending;
  };

  const createWindow = (): BrowserWindowLike => {
    const window = new options.BrowserWindow({
      width: 980,
      height: 680,
      minWidth: 480,
      minHeight: 480,
      title: 'HoldVue',
      icon: options.paths.icon,
      webPreferences: {
        preload: options.paths.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    window.webContents.setWindowOpenHandler(details => {
      let allowed = false;
      try {
        const url = new URL(details.url);
        const etherscan = url.protocol === 'https:' && url.hostname === 'etherscan.io' && url.port === '' && url.username === '' && url.password === '' && url.pathname === '/apis' && url.hash === '';
        const fmp = url.protocol === 'https:' && url.hostname === 'site.financialmodelingprep.com' && url.port === '' && url.username === '' && url.password === '' && url.pathname === '/developer/docs/stable' && url.hash === '';
        allowed = etherscan || fmp;
      } catch { allowed = false; }
      if (allowed && options.shell) {
        try { void Promise.resolve(options.shell.openExternal(details.url)).catch(() => undefined); } catch { /* external browser failures stay local */ }
      }
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', event => event.preventDefault());
    void window.loadFile(options.paths.renderer);
    window.on('closed', () => { windowRef = null; });
    windowRef = window;
    return window;
  };

  const registerIpc = (): void => {
    if (registered) return;
    registered = true;
    options.ipcMain.handle('holdvue:state', async () => {
      try { return { ok: true, value: await loadState() }; } catch { return failure('storage-failed', 'Local state could not be loaded.'); }
    });
    options.ipcMain.handle('holdvue:copy-wallet-address', async (...args: readonly unknown[]): Promise<PublicResult<CopyWalletSuccess>> => {
      const payload = requestPayload(args);
      if (typeof payload !== 'string' || payload.trim() === '') return failure('invalid-input', 'Wallet id is invalid.');
      let state: PortfolioState;
      try {
        state = await loadState();
      } catch { return failure('storage-failed', 'Local state could not be loaded.'); }
      const wallet = state.wallets.find(item => item.id === payload);
      if (!wallet) return failure('not-found', 'Wallet was not found.');
      if (!options.clipboard) return failure('clipboard-unavailable', 'Copy is unavailable.');
      try { await options.clipboard.writeText(wallet.address); return { ok: true, value: { copied: true } }; } catch { return failure('clipboard-failed', 'Copy is unavailable.'); }
    });
    options.ipcMain.handle('holdvue:detect-wallet', async (...args: readonly unknown[]): Promise<AddressDetection | PublicFailure> => {
      const payload = requestPayload(args);
      if (typeof payload !== 'string') return failure('invalid-input', 'A public address is required.');
      return detectAddress(payload);
    });
    options.ipcMain.handle('holdvue:add-wallet', (...args: readonly unknown[]) => {
      const payload = requestPayload(args);
      const input = asWalletAdd(payload);
      if (containsForbiddenField(payload)) return mutateWallet(() => failure('secret-input', 'Secret material is not accepted.'));
      return mutateWallet(state => {
        if (input === null) return failure('invalid-input', 'Wallet details are invalid.');
        const added = addWallet(state, input, { ids: options.ids, clock: options.clock });
        return added.ok ? { ok: true, value: enableOnboardingProvider(added.value, added.value.wallets[added.value.wallets.length - 1]!.family) } : added;
      });
    });
    options.ipcMain.handle('holdvue:update-wallet', (...args: readonly unknown[]) => {
      const payload = requestPayload(args);
      if (!isRecord(payload) || typeof payload.id !== 'string') return Promise.resolve(failure('invalid-input', 'Wallet id is invalid.'));
      if (containsForbiddenField(payload)) return mutateWallet(() => failure('secret-input', 'Secret material is not accepted.'));
      const input = asWalletEdit(payload.wallet ?? payload);
      return mutateWallet(state => input === null ? failure('invalid-input', 'Wallet details are invalid.') : updateWallet(state, payload.id as string, input));
    });
    options.ipcMain.handle('holdvue:delete-wallet', (...args: readonly unknown[]) => {
      const payload = requestPayload(args);
      const id = typeof payload === 'string' ? payload : isRecord(payload) && typeof payload.id === 'string' ? payload.id : null;
      return mutateWallet(state => id === null ? failure('invalid-input', 'Wallet id is invalid.') : deleteWallet(state, id));
    });
    options.ipcMain.handle('holdvue:search-instruments', async (...args: readonly unknown[]): Promise<PublicResult<readonly InstrumentCandidate[]>> => {
      searchController?.abort();
      searchController = null;
      const payload = requestPayload(args);
      if (typeof payload !== 'string' || payload.trim() === '' || payload.length > 120) return failure('invalid-input', 'Search text is invalid.');
      if (!options.instrumentSearch) return failure('unconfigured', 'An instrument provider key is required.');
      const controller = new AbortController();
      searchController = controller;
      try {
        const result = await options.instrumentSearch.search(payload, controller.signal);
        if (searchController === controller) searchController = null;
        return result.ok ? { ok: true, value: result.value } : failure(result.code, result.message);
      } catch (error) {
        if (searchController === controller) searchController = null;
        return failure(controller.signal.aborted || (error instanceof Error && error.name === 'AbortError') ? 'aborted' : 'search-failed', controller.signal.aborted ? 'Instrument search was cancelled.' : 'Instrument search failed.');
      }
    });
    options.ipcMain.handle('holdvue:add-holding', async (...args: readonly unknown[]) => {
      const payload = requestPayload(args);
      if (containsForbiddenField(payload)) return rejectedMutation('secret-input', 'Secret material is not accepted.');
      const input = asHoldingAdd(payload);
      if (input === null) return rejectedMutation('invalid-input', 'Holding details are invalid.');
      const instrument = await resolveInstrument(input.instrument);
      if ('ok' in instrument && instrument.ok === false) return instrument;
      return mutateHolding(state => addHolding(state, { instrument: instrument as InstrumentInput, quantity: input.quantity }, { ids: options.ids, clock: options.clock }));
    });
    options.ipcMain.handle('holdvue:update-holding', async (...args: readonly unknown[]) => {
      const payload = requestPayload(args);
      if (!isRecord(payload) || typeof payload.id !== 'string' || payload.id.trim() === '' || containsForbiddenField(payload)) return rejectedMutation('invalid-input', 'Holding id is invalid.');
      const input = asHoldingEdit(payload.holding ?? payload);
      if (input === null) return rejectedMutation('invalid-input', 'Holding details are invalid.');
      if (input.instrument !== undefined) {
        const instrument = await resolveInstrument(input.instrument);
        if ('ok' in instrument && instrument.ok === false) return instrument;
        return mutateHolding(state => updateHolding(state, payload.id as string, { ...input, instrument: instrument as InstrumentInput }, { ids: options.ids, clock: options.clock }));
      }
      return mutateHolding(state => updateHolding(state, payload.id as string, { quantity: input.quantity }, { ids: options.ids, clock: options.clock }));
    });
    options.ipcMain.handle('holdvue:delete-holding', (...args: readonly unknown[]) => {
      const payload = requestPayload(args);
      const id = typeof payload === 'string' ? payload : isRecord(payload) && typeof payload.id === 'string' ? payload.id : null;
      return mutateHolding(state => id === null || id.trim() === '' ? failure('invalid-input', 'Holding id is invalid.') : deleteHolding(state, id));
    });
    options.ipcMain.handle('holdvue:update-settings', (...args: readonly unknown[]) => {
      const payload = requestPayload(args);
      if (containsForbiddenField(payload)) return rejectedMutation('secret-input', 'Secret material is not accepted.');
      const patch = isRecord(payload) ? payload as Partial<Omit<Settings, 'schemaVersion'>> : {};
      return mutateSettings(patch);
    });
    options.ipcMain.handle('holdvue:set-etherscan-key', (...args: readonly unknown[]) => mutateProviderKey('evm.erc20', requestPayload(args), false));
    options.ipcMain.handle('holdvue:delete-etherscan-key', () => mutateProviderKey('evm.erc20', undefined, true));
    options.ipcMain.handle('holdvue:set-fmp-key', (...args: readonly unknown[]) => mutateProviderKey('fmp.market', requestPayload(args), false));
    options.ipcMain.handle('holdvue:delete-fmp-key', () => mutateProviderKey('fmp.market', undefined, true));
    options.ipcMain.handle('holdvue:refresh', () => refresh());
  };

  const start = (): Promise<void> => {
    registerIpc();
    if (startPromise) return startPromise;
    startPromise = options.storage.load().catch(() => null).then(state => {
      if (!state || state.settings.schedulerEnabled) options.scheduler.start();
      return options.app.whenReady();
    }).then(() => {
      if (!windowRef) createWindow();
      options.app.on('activate', () => {
        void loadState().then(state => { if (state.settings.schedulerEnabled) options.scheduler.start(); }).catch(() => undefined);
        if (options.BrowserWindow.getAllWindows().length === 0) createWindow();
      });
      options.app.on('window-all-closed', () => {
        options.scheduler.stop();
        if (options.platform !== 'darwin') options.app.quit();
      });
      if (options.sync) void refresh();
    });
    return startPromise;
  };

  const emitMinute = (): void => {
    if (windowRef && !windowRef.isDestroyed()) windowRef.webContents.send('holdvue:minute');
  };

  return {
    start,
    stop: () => { searchController?.abort(); searchController = null; options.scheduler.stop(); options.sync?.coordinator.stop(); },
    emitMinute: () => { if (options.sync) void refresh(); else emitMinute(); },
    getWindow: () => windowRef
  };
}
