export type Currency = 'EUR' | 'USD';
export type Locale = 'de' | 'en';

export interface WalletAccount {
  readonly id: string;
  readonly label: string;
  readonly network: string;
  readonly address: string;
}

export interface WalletAdapter {
  readonly id: string;
  listAccounts(signal?: AbortSignal): Promise<readonly WalletAccount[]>;
}

export interface MarketPrice {
  readonly instrumentId: string;
  readonly timestamp: number;
  readonly price: number;
  readonly currency: Currency;
}

export interface MarketPriceAdapter {
  readonly id: string;
  getLatest(instrumentIds: readonly string[], currency: Currency, signal?: AbortSignal): Promise<readonly MarketPrice[]>;
  getHistory(instrumentId: string, from: number, to: number, currency: Currency, signal?: AbortSignal): Promise<readonly MarketPrice[]>;
}

export interface Instrument {
  readonly id: string;
  readonly symbol: string;
  readonly name: string;
}

export interface InstrumentSearchAdapter {
  readonly id: string;
  search(query: string, signal?: AbortSignal): Promise<readonly Instrument[]>;
}

export interface ProviderPorts {
  readonly wallets?: WalletAdapter;
  readonly marketPrices?: MarketPriceAdapter;
  readonly instruments?: InstrumentSearchAdapter;
}
