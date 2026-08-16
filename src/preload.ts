import { createRequire } from 'node:module';
import type { AddressDetection } from './shared/addresses.ts';
import type { HoldingAddRequest, HoldingEditRequest, PublicResult, CopyWalletSuccess, WalletAddRequest, WalletEditRequest } from './main-app.ts';
import type { PortfolioState, Settings } from './shared/state.ts';
import type { InstrumentCandidate } from './shared/market.ts';

export interface IpcRendererLike {
  invoke(channel: string, ...args: readonly unknown[]): Promise<unknown>;
  on(channel: string, callback: () => void): void;
  removeListener(channel: string, callback: () => void): void;
}

export interface ContextBridgeLike {
  exposeInMainWorld(name: string, value: unknown): void;
}

export interface HoldVueApi {
  getState(): Promise<PublicResult<PortfolioState>>;
  detectWalletAddress(address: string): Promise<AddressDetection | { readonly ok: false; readonly code: string; readonly message: string }>;
  addWallet(input: WalletAddRequest): Promise<PublicResult<PortfolioState>>;
  updateWallet(id: string, input: WalletEditRequest): Promise<PublicResult<PortfolioState>>;
  deleteWallet(id: string): Promise<PublicResult<PortfolioState>>;
  copyWalletAddress(id: string): Promise<PublicResult<CopyWalletSuccess>>;
  searchInstruments(query: string): Promise<PublicResult<readonly InstrumentCandidate[]>>;
  addHolding(input: HoldingAddRequest): Promise<PublicResult<PortfolioState>>;
  updateHolding(id: string, input: HoldingEditRequest): Promise<PublicResult<PortfolioState>>;
  deleteHolding(id: string): Promise<PublicResult<PortfolioState>>;
  setEtherscanKey(value: string): Promise<PublicResult<PortfolioState>>;
  deleteEtherscanKey(): Promise<PublicResult<PortfolioState>>;
  setFmpKey(value: string): Promise<PublicResult<PortfolioState>>;
  deleteFmpKey(): Promise<PublicResult<PortfolioState>>;
  updateSettings(settings: Partial<Omit<Settings, 'schemaVersion'>>): Promise<PublicResult<PortfolioState>>;
  refresh(): Promise<PublicResult<PortfolioState>>;
  onMinute(callback: () => void): () => void;
}

export function createPreloadApi(ipcRenderer: IpcRendererLike): HoldVueApi {
  return {
    getState: () => ipcRenderer.invoke('holdvue:state') as Promise<PublicResult<PortfolioState>>,
    detectWalletAddress: address => ipcRenderer.invoke('holdvue:detect-wallet', address) as Promise<AddressDetection | { readonly ok: false; readonly code: string; readonly message: string }>,
    addWallet: input => ipcRenderer.invoke('holdvue:add-wallet', input) as Promise<PublicResult<PortfolioState>>,
    updateWallet: (id, input) => ipcRenderer.invoke('holdvue:update-wallet', { id, wallet: input }) as Promise<PublicResult<PortfolioState>>,
    deleteWallet: id => ipcRenderer.invoke('holdvue:delete-wallet', id) as Promise<PublicResult<PortfolioState>>,
    copyWalletAddress: id => ipcRenderer.invoke('holdvue:copy-wallet-address', id) as Promise<PublicResult<CopyWalletSuccess>>,
    searchInstruments: query => ipcRenderer.invoke('holdvue:search-instruments', query) as Promise<PublicResult<readonly InstrumentCandidate[]>>,
    addHolding: input => ipcRenderer.invoke('holdvue:add-holding', input) as Promise<PublicResult<PortfolioState>>,
    updateHolding: (id, input) => ipcRenderer.invoke('holdvue:update-holding', { id, holding: input }) as Promise<PublicResult<PortfolioState>>,
    deleteHolding: id => ipcRenderer.invoke('holdvue:delete-holding', id) as Promise<PublicResult<PortfolioState>>,
    setEtherscanKey: value => ipcRenderer.invoke('holdvue:set-etherscan-key', value) as Promise<PublicResult<PortfolioState>>,
    deleteEtherscanKey: () => ipcRenderer.invoke('holdvue:delete-etherscan-key') as Promise<PublicResult<PortfolioState>>,
    setFmpKey: value => ipcRenderer.invoke('holdvue:set-fmp-key', value) as Promise<PublicResult<PortfolioState>>,
    deleteFmpKey: () => ipcRenderer.invoke('holdvue:delete-fmp-key') as Promise<PublicResult<PortfolioState>>,
    updateSettings: settings => ipcRenderer.invoke('holdvue:update-settings', settings) as Promise<PublicResult<PortfolioState>>,
    refresh: () => ipcRenderer.invoke('holdvue:refresh') as Promise<PublicResult<PortfolioState>>,
    onMinute(callback) {
      ipcRenderer.on('holdvue:minute', callback);
      return () => ipcRenderer.removeListener('holdvue:minute', callback);
    }
  };
}

export function installPreloadBridge(contextBridge: ContextBridgeLike, ipcRenderer: IpcRendererLike): HoldVueApi {
  const api = createPreloadApi(ipcRenderer);
  contextBridge.exposeInMainWorld('holdvue', api);
  return api;
}

export function loadRuntimeModule(name: string): Record<string, unknown> {
  return createRequire(import.meta.url)(name) as Record<string, unknown>;
}

export function startPreload(load: (name: string) => Record<string, unknown> = loadRuntimeModule): HoldVueApi {
  const electron = load('electron') as { contextBridge: ContextBridgeLike; ipcRenderer: IpcRendererLike };
  return installPreloadBridge(electron.contextBridge, electron.ipcRenderer);
}

export function runPreload(isElectron: boolean, launch: () => unknown = startPreload): unknown {
  if (isElectron) return launch();
  return null;
}

runPreload(Boolean(process.versions.electron));
