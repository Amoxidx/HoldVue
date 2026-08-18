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
