import type { AddressDetection, AddressMatch } from '../shared/addresses.ts';
import type { Holding, Instrument, PortfolioState, Settings, WalletFamily, WalletSource } from '../shared/state.ts';
import { scaledToDecimal } from '../shared/pricing.ts';
import type { InstrumentCandidate } from '../shared/market.ts';
import type { HoldVueApi } from '../preload-api.d.ts';
import { buildPortfolioViewModel, formatPortfolioValue, rangeWindow, selectHistoryPoints, sortPortfolioAssets, type PortfolioAssetView, type PortfolioRange, type PortfolioSort } from '../shared/portfolio.ts';
import { bindChart } from './chart.ts';

export interface RendererElement {
  textContent: string | null;
  innerHTML?: string;
  value?: string;
  checked?: boolean;
  hidden?: boolean;
  disabled?: boolean;
  className?: string;
  clientWidth?: number;
  clientHeight?: number;
  dataset?: Record<string, string>;
  addEventListener?(type: string, callback: (event: Event) => void): void;
  removeEventListener?(type: string, callback: (event: Event) => void): void;
  dispatchEvent?(event: Event): boolean;
  click?(): void;
  querySelector?(selector: string): RendererElement | null;
  querySelectorAll?(selector: string): unknown;
  setAttribute?(name: string, value: string): void;
  getAttribute?(name: string): string | null;
  focus?(): void;
  showModal?(): void;
  close?(): void;
}

export interface RendererDocument {
  readonly documentElement: { lang: string; dataset: Record<string, string> };
  querySelector<T extends RendererElement = RendererElement>(selector: string): T | null;
  querySelectorAll?(selector: string): unknown;
  addEventListener?(type: string, callback: (event: Event) => void): void;
  removeEventListener?(type: string, callback: (event: Event) => void): void;
  activeElement?: RendererElement | null;
}

interface StatusElement extends RendererElement { textContent: string | null; }

export interface RendererController {
  render(): Promise<void>;
  start(): () => void;
}

type LocaleCode = 'de' | 'en';
type MessageKey = keyof typeof messages.de;

const messages = {
  de: {
    'status.ready': 'Lokal bereit', 'status.saved': 'Änderung gespeichert', 'status.error': 'Lokaler Fehler', 'status.copy': 'Adresse kopiert', 'status.copyUnavailable': 'Kopieren nicht verfügbar', 'status.syncing': 'Synchronisierung läuft', 'status.syncOk': 'Synchronisiert', 'status.pricesUpdated': 'Kurse aktualisiert', 'status.syncEmpty': 'Noch keine Walletdaten', 'status.syncReady': 'Wallet-Sync bereit', 'status.syncPartial': 'Teilweise synchronisiert', 'status.syncError': 'Synchronisierung fehlgeschlagen', 'status.syncRate': 'Provider-Limit erreicht', 'button.refresh': 'Jetzt synchronisieren', 'sync.last': 'Letzte Wallet-Synchronisierung', 'detection.detected': 'Erkannt', 'detection.prompt': 'Adresse eingeben oder einfügen', 'detection.checking': 'Adresse wird lokal geprüft …',
    'hero.eyebrow': 'LOCAL-FIRST PORTFOLIO', 'hero.title': 'Dein Portfolio auf einen Blick.', 'hero.lede': 'Wallets, Aktien und ETFs – automatisch aktualisiert und lokal gespeichert.', 'hero.total': 'Gesamtwert',
    'wallet.eyebrow': 'WALLETS / WALLET-QUELLEN', 'wallet.title': 'Wallets', 'wallet.copy': 'Verwalte öffentliche Adressen und Extended Public Keys. Synchronisierung bleibt providerabhängig; keine NFTs.', 'wallet.add': 'Wallet hinzufügen', 'wallet.empty': 'Noch keine Wallets verbunden.',
    'holdings.eyebrow': 'MANUELLE BESTÄNDE', 'holdings.title': 'Aktien und ETFs', 'holdings.copy': 'Wähle ein Instrument aus der Suche und hinterlege nur die Stückzahl. Preise werden hier nicht erfunden.', 'holdings.add': 'Aktie/ETF hinzufügen', 'holdings.empty': 'Noch keine manuellen Bestände.', 'holdings.noResults': 'Keine passenden Instrumente gefunden.', 'holdings.search': 'Instrument suchen', 'holdings.searchPlaceholder': 'Name oder Symbol eingeben', 'holdings.searchHelp': 'Lokale Katalogtreffer sind ohne Key speicherbar. Yahoo Finance liefert die Standardkurse; FMP bleibt ein optionaler Fallback.', 'holdings.localCatalog': 'LOKAL', 'holdings.quantity': 'Stückzahl', 'holdings.edit': 'Bestand bearbeiten', 'holdings.deleteTitle': 'Bestand löschen', 'holdings.deleteCopy': 'Der manuelle Bestand wird aus dem lokalen Portfolio entfernt. Diese Aktion kann nicht rückgängig gemacht werden.', 'holdings.typePending': 'Typ wird geprüft', 'holdings.localPriceHint': 'Lokaler Katalogtreffer: Speichern ist ohne Key möglich. Yahoo Finance liefert automatische Standardkurse.', 'holdings.localPriceActiveHint': 'Lokaler Katalogtreffer: Speichern ist ohne Key möglich. Die keyless Standardquelle Yahoo Finance ist aktiv.', 'holdings.fmpPriceHint': 'Keine automatische Kursquelle aktiv. Aktiviere Yahoo Finance in den Einstellungen.',
    'portfolio.aria': 'Portfolio-Status', 'portfolio.eyebrow': 'PORTFOLIO', 'portfolio.title': 'Portfolio', 'portfolio.copy': 'Werte und Preise werden lokal aufgebaut.', 'portfolio.assets': 'Assets', 'portfolio.valued': 'bewertet', 'portfolio.unpriced': 'Preis noch nicht verfügbar', 'portfolio.priceUnconfigured': 'Keine Preisquelle eingerichtet', 'portfolio.priceMissing': 'Noch kein Kurs für dieses Instrument verfügbar', 'portfolio.pricePartial': 'Kurs nur teilweise verfügbar', 'portfolio.priceRateLimited': 'Preisquelle meldet ein Limit', 'portfolio.priceError': 'Preisquelle nicht erreichbar', 'portfolio.priceStale': 'Letzter Kurs wird verwendet', 'portfolio.priceSource': 'Preisquelle', 'portfolio.setupPriceSource': 'Preisquelle einrichten', 'portfolio.sort': 'Sortieren', 'portfolio.sortSize': 'Größe', 'portfolio.sortGainers': 'Gewinner', 'portfolio.sortLosers': 'Verlierer', 'portfolio.hidden': 'Ausgeblendete Assets', 'portfolio.hide': 'Asset ausblenden', 'portfolio.restore': 'Wiederherstellen', 'portfolio.showValue': 'Wert anzeigen', 'portfolio.showQuantity': 'Menge anzeigen', 'portfolio.account': 'Konto', 'portfolio.balance': 'Bestand', 'portfolio.chartEmpty': 'Noch keine Historie. Der Verlauf wird lokal aufgebaut.', 'portfolio.chartTooShort': 'Ein Punkt ist vorhanden; weitere Daten werden lokal aufgebaut.', 'portfolio.rangeEmpty': 'Für diesen Zeitraum sind noch keine Daten vorhanden.', 'portfolio.empty': 'Noch keine gehaltenen Assets.', 'portfolio.multipleAccounts': 'Mehrere Konten', 'portfolio.history': 'Portfolioverlauf', 'portfolio.assetPriceHistory': 'Preisverlauf', 'portfolio.unitPrice': 'Stückpreis', 'portfolio.chartRange': 'Zeitraum des Charts',
    'portfolio.value': 'Wert', 'range.1D': '1T', 'range.7D': '7T', 'range.1M': '1M', 'range.1Y': '1J', 'range.MAX': 'MAX', 'footer.local': 'HoldVue · lokal gespeichert', 'footer.theme.light': 'Hell', 'footer.theme.dark': 'Dunkel',
    'dialog.public': 'ÖFFENTLICHE QUELLE', 'dialog.add': 'Wallet hinzufügen', 'dialog.edit': 'Wallet bearbeiten', 'dialog.copy': 'Nur öffentliche Adresse oder xpub. Keine Seed-Phrase und kein privater Schlüssel.',
    'field.address': 'Adresse oder Extended Public Key', 'field.label': 'Label / Name', 'field.labelPlaceholder': 'z. B. Hauptwallet', 'field.family': 'Erkannte Familie', 'field.familyEmpty': 'Adresse zuerst prüfen', 'field.evmChains': 'EVM-Chains', 'field.allEvm': 'Alle gängigen Chains automatisch prüfen', 'field.enabled': 'Aktiv', 'field.walletEnabled': 'Wallet automatisch synchronisieren',
    'button.close': 'Schließen', 'button.cancel': 'Abbrechen', 'button.save': 'Speichern', 'button.done': 'Fertig', 'button.copy': 'Kopieren', 'button.edit': 'Bearbeiten', 'button.delete': 'Löschen', 'button.detect': 'Adresse prüfen',
    'wallet.addressFor': 'Adresse von', 'wallet.active': 'Aktiv', 'wallet.disabled': 'Pausiert', 'wallet.allChains': 'Alle gängigen Chains', 'wallet.selectedChains': 'Ausgewählte Chains',
    'delete.eyebrow': 'AKTION BESTÄTIGEN', 'delete.title': 'Wallet löschen', 'delete.copy': 'Die Wallet und zugehörige lokale Positionen werden entfernt. Diese Aktion kann nicht rückgängig gemacht werden.', 'delete.keyTitle': 'Provider-Key entfernen', 'delete.keyCopy': 'Der verschlüsselt gespeicherte Key wird lokal entfernt. Der betroffene optionale Provider steht danach nicht mehr zur Verfügung.',
    'settings.eyebrow': 'LOKALE EINSTELLUNGEN', 'settings.title': 'Einstellungen', 'settings.currency': 'Währung', 'settings.locale': 'Sprache', 'settings.theme': 'Darstellung', 'settings.automation': 'Lokale Automatisierung', 'settings.scheduler': 'Minütliche Aktualisierung', 'settings.spam': 'Spamfilter aktiv', 'settings.hiddenSpam': 'Verborgene Spamassets zeigen', 'settings.providers': 'Provider aktivieren', 'settings.providerConfig': 'Preisquellen und Schlüssel', 'settings.advanced': 'Erweiterte Netzwerkoptionen', 'settings.advancedHelp': 'Nur bei Bedarf: credential-freie HTTPS-RPC-Overrides pro EVM-Chain.', 'settings.etherscanKey': 'Kostenloser Etherscan-Key (verschlüsselt)', 'settings.fmpKey': 'FMP-Key für optionalen Aktien-/ETF-Fallback (verschlüsselt)', 'settings.keyPlaceholder': 'Nur zum Speichern eingeben', 'settings.keyConfigured': 'Etherscan-Key konfiguriert', 'settings.keyNotConfigured': 'Kein Etherscan-Key konfiguriert', 'settings.fmpConfigured': 'FMP-Fallback konfiguriert · Yahoo Finance bleibt Standard', 'settings.fmpNotConfigured': 'Yahoo Finance · keyless Standardquelle aktiv', 'settings.etherscanHelp': 'Kostenloser Key ermöglicht native EVM-Balances und begrenzte Token-Erkennung; Limits bleiben sichtbar.', 'settings.etherscanLink': 'Etherscan-Key beantragen', 'settings.fmpHelp': 'Der lokale Instrumentkatalog und Yahoo Finance funktionieren ohne Key. FMP ist ein optionaler Fallback für zusätzliche Kurse; Provider-Limits bleiben sichtbar.', 'settings.fmpLink': 'FMP-Dokumentation', 'settings.solanaEndpoint': 'Solana RPC-Override (HTTPS)', 'settings.rpcOverrides': 'EVM-RPC-Overrides', 'settings.rpcHelp': 'Optional, credential-freie HTTPS-Endpunkte pro Chain.', 'button.saveKey': 'Key speichern', 'button.deleteKey': 'Key entfernen', 'provider.evm': 'EVM-RPC', 'provider.bitcoin': 'Bitcoin · mempool.space', 'provider.solana': 'Solana JSON-RPC', 'provider.cardano': 'Cardano · Koios', 'provider.yahoo': 'Yahoo Finance · Aktien/ETFs', 'settings.wallets': 'Wallet-Verwaltung',
    'locale.de': 'Deutsch', 'locale.en': 'English', 'theme.light': 'Hell', 'theme.dark': 'Dunkel', 'network.mainnet': 'Mainnet', 'network.testnet': 'Testnet', 'network.devnet': 'Devnet', 'network.mainnetBeta': 'Mainnet-beta',
    'error.invalid-input': 'Die Eingaben sind ungültig.', 'error.invalid-label': 'Ein Label ist erforderlich.', 'error.invalid-address': 'Die öffentliche Adresse wird nicht unterstützt.', 'error.ambiguous-address': 'Die Adresse ist nicht eindeutig.', 'error.duplicate-wallet': 'Diese Wallet ist bereits verbunden.', 'error.not-found': 'Die Wallet wurde nicht gefunden.', 'error.secret-input': 'Seeds und private Schlüssel werden nicht akzeptiert.', 'error.invalid': 'Keine unterstützte öffentliche Adresse erkannt.', 'error.ambiguous': 'Die Adresse ist nicht eindeutig.', 'error.invalid-chain-selection': 'Wähle mindestens eine EVM-Chain oder aktiviere alle gängigen Chains.', 'error.invalid-instrument': 'Die Instrumentdaten sind ungültig.', 'error.invalid-quantity': 'Die Stückzahl muss positiv sein und darf höchstens zwei Nachkommastellen haben.', 'error.duplicate-holding': 'Dieses Instrument ist bereits als Bestand erfasst.', 'error.unconfigured': 'Die Instrument-Suche ist in den Einstellungen deaktiviert.', 'error.rate-limited': 'Das Provider-Limit für die Instrument-Suche ist erreicht.', 'error.unauthorized': 'Der optionale Provider-Key wurde abgelehnt.', 'error.timeout': 'Die Instrument-Suche hat zu lange gedauert.', 'error.aborted': 'Die Instrument-Suche wurde abgebrochen.', 'error.malformed': 'Die Provider-Antwort konnte nicht sicher gelesen werden.', 'error.search-failed': 'Die Instrument-Suche ist fehlgeschlagen.', 'error.storage-failed': 'Der lokale Zustand konnte nicht aktualisiert werden.', 'error.clipboard-unavailable': 'Kopieren ist nicht verfügbar.', 'error.clipboard-failed': 'Kopieren ist nicht verfügbar.', 'error.generic': 'Die Aktion konnte nicht abgeschlossen werden.', 'error.detect': 'Die Adresse konnte nicht geprüft werden.'
  },
  en: {
    'status.ready': 'Ready locally', 'status.saved': 'Changes saved', 'status.error': 'Local error', 'status.copy': 'Address copied', 'status.copyUnavailable': 'Copy is unavailable', 'status.syncing': 'Syncing wallets', 'status.syncOk': 'Synchronized', 'status.pricesUpdated': 'Prices updated', 'status.syncEmpty': 'No wallet data yet', 'status.syncReady': 'Wallet sync ready', 'status.syncPartial': 'Partially synchronized', 'status.syncError': 'Synchronization failed', 'status.syncRate': 'Provider limit reached', 'button.refresh': 'Sync now', 'sync.last': 'Last wallet synchronization', 'detection.detected': 'Detected', 'detection.prompt': 'Enter or paste an address', 'detection.checking': 'Checking address locally …',
    'hero.eyebrow': 'LOCAL-FIRST PORTFOLIO', 'hero.title': 'Your portfolio at a glance.', 'hero.lede': 'Wallets, stocks and ETFs – automatically refreshed and stored locally.', 'hero.total': 'Total value',
    'wallet.eyebrow': 'WALLETS / WALLET SOURCES', 'wallet.title': 'Wallets', 'wallet.copy': 'Manage public addresses and extended public keys. Synchronization depends on providers; no NFTs.', 'wallet.add': 'Add wallet', 'wallet.empty': 'No wallets connected yet.',
    'holdings.eyebrow': 'MANUAL HOLDINGS', 'holdings.title': 'Stocks and ETFs', 'holdings.copy': 'Choose an instrument from search and enter only the quantity. No prices are invented here.', 'holdings.add': 'Add stock/ETF', 'holdings.empty': 'No manual holdings yet.', 'holdings.noResults': 'No matching instruments found.', 'holdings.search': 'Search instrument', 'holdings.searchPlaceholder': 'Enter name or symbol', 'holdings.searchHelp': 'Local catalog hits can be saved without a key. Yahoo Finance is the keyless standard price source; FMP is an optional fallback.', 'holdings.localCatalog': 'LOCAL', 'holdings.quantity': 'Quantity', 'holdings.edit': 'Edit holding', 'holdings.deleteTitle': 'Delete holding', 'holdings.deleteCopy': 'The manual holding will be removed from the local portfolio. This action cannot be undone.', 'holdings.typePending': 'Type pending verification', 'holdings.localPriceHint': 'Local catalog hit: saving does not require a key. Yahoo Finance provides automatic standard prices.', 'holdings.localPriceActiveHint': 'Local catalog hit: saving does not require a key. The keyless Yahoo Finance standard source is active.', 'holdings.fmpPriceHint': 'No automatic price source is active. Enable Yahoo Finance in Settings.',
    'portfolio.aria': 'Portfolio status', 'portfolio.eyebrow': 'PORTFOLIO', 'portfolio.title': 'Portfolio', 'portfolio.copy': 'Values and prices are built locally over time.', 'portfolio.assets': 'Assets', 'portfolio.valued': 'valued', 'portfolio.unpriced': 'Price not yet available', 'portfolio.priceUnconfigured': 'No price source configured', 'portfolio.priceMissing': 'No quote is available for this instrument yet', 'portfolio.pricePartial': 'Quote is only partially available', 'portfolio.priceRateLimited': 'Price source rate limit reached', 'portfolio.priceError': 'Price source is unavailable', 'portfolio.priceStale': 'Using the last known quote', 'portfolio.priceSource': 'Price source', 'portfolio.setupPriceSource': 'Set up price source', 'portfolio.sort': 'Sort by', 'portfolio.sortSize': 'Size', 'portfolio.sortGainers': 'Gainers', 'portfolio.sortLosers': 'Losers', 'portfolio.hidden': 'Hidden assets', 'portfolio.hide': 'Hide asset', 'portfolio.restore': 'Restore', 'portfolio.showValue': 'Show value', 'portfolio.showQuantity': 'Show quantity', 'portfolio.account': 'Account', 'portfolio.balance': 'Balance', 'portfolio.chartEmpty': 'No history yet. The local series starts building now.', 'portfolio.chartTooShort': 'One point is available; more local data will follow.', 'portfolio.rangeEmpty': 'No data exists for this range yet.', 'portfolio.empty': 'No held assets yet.', 'portfolio.multipleAccounts': 'Multiple accounts', 'portfolio.history': 'Portfolio history', 'portfolio.assetPriceHistory': 'Price history', 'portfolio.unitPrice': 'Unit price', 'portfolio.chartRange': 'Chart range',
    'portfolio.value': 'Value', 'range.1D': '1D', 'range.7D': '7D', 'range.1M': '1M', 'range.1Y': '1Y', 'range.MAX': 'MAX', 'footer.local': 'HoldVue · stored locally', 'footer.theme.light': 'Light', 'footer.theme.dark': 'Dark',
    'dialog.public': 'PUBLIC SOURCE', 'dialog.add': 'Add wallet', 'dialog.edit': 'Edit wallet', 'dialog.copy': 'Public address or xpub only. No seed phrase or private key.',
    'field.address': 'Address or extended public key', 'field.label': 'Label / name', 'field.labelPlaceholder': 'e.g. Main wallet', 'field.family': 'Detected family', 'field.familyEmpty': 'Check address first', 'field.evmChains': 'EVM chains', 'field.allEvm': 'Scan all common chains automatically', 'field.enabled': 'Enabled', 'field.walletEnabled': 'Sync wallet automatically',
    'button.close': 'Close', 'button.cancel': 'Cancel', 'button.save': 'Save', 'button.done': 'Done', 'button.copy': 'Copy', 'button.edit': 'Edit', 'button.delete': 'Delete', 'button.detect': 'Check address',
    'wallet.addressFor': 'Address for', 'wallet.active': 'Enabled', 'wallet.disabled': 'Disabled', 'wallet.allChains': 'All common chains', 'wallet.selectedChains': 'Selected chains',
    'delete.eyebrow': 'CONFIRM ACTION', 'delete.title': 'Delete wallet', 'delete.copy': 'The wallet and its local positions will be removed. This action cannot be undone.', 'delete.keyTitle': 'Remove provider key', 'delete.keyCopy': 'The encrypted key will be removed locally. The affected optional provider will no longer be available.',
    'settings.eyebrow': 'LOCAL SETTINGS', 'settings.title': 'Settings', 'settings.currency': 'Currency', 'settings.locale': 'Language', 'settings.theme': 'Theme', 'settings.automation': 'Local automation', 'settings.scheduler': 'Minute refresh', 'settings.spam': 'Spam filter enabled', 'settings.hiddenSpam': 'Show hidden spam assets', 'settings.providers': 'Enable providers', 'settings.providerConfig': 'Price sources and keys', 'settings.advanced': 'Advanced network options', 'settings.advancedHelp': 'Only when needed: credential-free HTTPS RPC overrides per EVM chain.', 'settings.etherscanKey': 'Free Etherscan key (encrypted)', 'settings.fmpKey': 'FMP key for optional stock/ETF fallback (encrypted)', 'settings.keyPlaceholder': 'Enter only to save', 'settings.keyConfigured': 'Etherscan key configured', 'settings.keyNotConfigured': 'No Etherscan key configured', 'settings.fmpConfigured': 'FMP fallback configured · Yahoo Finance remains standard', 'settings.fmpNotConfigured': 'Yahoo Finance · keyless standard source active', 'settings.etherscanHelp': 'A free key enables native EVM balances and bounded token discovery; limits remain visible.', 'settings.etherscanLink': 'Request an Etherscan key', 'settings.fmpHelp': 'The local catalog and Yahoo Finance work without a key. FMP is an optional fallback for additional quotes; provider limits remain visible.', 'settings.fmpLink': 'FMP documentation', 'settings.solanaEndpoint': 'Solana RPC override (HTTPS)', 'settings.rpcOverrides': 'EVM RPC overrides', 'settings.rpcHelp': 'Optional credential-free HTTPS endpoint per chain.', 'button.saveKey': 'Save key', 'button.deleteKey': 'Remove key', 'provider.evm': 'EVM JSON-RPC', 'provider.bitcoin': 'Bitcoin · mempool.space', 'provider.solana': 'Solana JSON-RPC', 'provider.cardano': 'Cardano · Koios', 'provider.yahoo': 'Yahoo Finance · Stocks/ETFs', 'settings.wallets': 'Wallet management',
    'locale.de': 'Deutsch', 'locale.en': 'English', 'theme.light': 'Light', 'theme.dark': 'Dark', 'network.mainnet': 'Mainnet', 'network.testnet': 'Testnet', 'network.devnet': 'Devnet', 'network.mainnetBeta': 'Mainnet-beta',
    'error.invalid-input': 'The input is invalid.', 'error.invalid-label': 'A label is required.', 'error.invalid-address': 'The public address is not supported.', 'error.ambiguous-address': 'The address is ambiguous.', 'error.duplicate-wallet': 'This wallet is already connected.', 'error.not-found': 'The wallet was not found.', 'error.secret-input': 'Seeds and private keys are not accepted.', 'error.invalid': 'No supported public address was detected.', 'error.ambiguous': 'The address is ambiguous.', 'error.invalid-chain-selection': 'Select at least one EVM chain or enable all common chains.', 'error.invalid-instrument': 'Instrument metadata is invalid.', 'error.invalid-quantity': 'Quantity must be positive with at most two decimals.', 'error.duplicate-holding': 'This instrument is already recorded.', 'error.unconfigured': 'Instrument search is disabled in Settings.', 'error.rate-limited': 'The instrument provider rate limit was reached.', 'error.unauthorized': 'The optional provider key was rejected.', 'error.timeout': 'Instrument search timed out.', 'error.aborted': 'Instrument search was cancelled.', 'error.malformed': 'The provider response could not be read safely.', 'error.search-failed': 'Instrument search failed.', 'error.storage-failed': 'The local state could not be updated.', 'error.clipboard-unavailable': 'Copy is unavailable.', 'error.clipboard-failed': 'Copy is unavailable.', 'error.generic': 'The action could not be completed.', 'error.detect': 'The address could not be checked.'
  }
} as const;

const errorKeys: Record<string, MessageKey> = {
  'invalid-input': 'error.invalid-input', 'invalid-label': 'error.invalid-label', 'invalid-address': 'error.invalid-address', 'ambiguous-address': 'error.ambiguous-address', duplicate: 'error.duplicate-wallet', 'duplicate-wallet': 'error.duplicate-wallet', 'not-found': 'error.not-found', 'secret-input': 'error.secret-input', invalid: 'error.invalid', ambiguous: 'error.ambiguous', 'invalid-chain-selection': 'error.invalid-chain-selection', 'invalid-instrument': 'error.invalid-instrument', 'invalid-quantity': 'error.invalid-quantity', 'duplicate-holding': 'error.duplicate-holding', unconfigured: 'error.unconfigured', 'rate-limited': 'error.rate-limited', unauthorized: 'error.unauthorized', timeout: 'error.timeout', aborted: 'error.aborted', malformed: 'error.malformed', 'search-failed': 'error.search-failed', 'storage-failed': 'error.storage-failed', 'secret-storage-unavailable': 'error.generic', 'secret-storage-failed': 'error.storage-failed', 'clipboard-unavailable': 'error.clipboard-unavailable', 'clipboard-failed': 'error.clipboard-failed', detect: 'error.detect'
};

const families: readonly WalletFamily[] = ['evm', 'bitcoin', 'solana', 'cardano'];
const bitcoinKinds = new Set(['xpub', 'ypub', 'zpub', 'tpub', 'upub', 'vpub']);
const MAX_PUBLIC_INPUT_LENGTH = 256;

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character)); }
function message(locale: LocaleCode, key: MessageKey): string { return messages[locale][key]; }
const networkKeys: Record<string, MessageKey> = { mainnet: 'network.mainnet', testnet: 'network.testnet', devnet: 'network.devnet', 'mainnet-beta': 'network.mainnetBeta' };
function networkKey(value: string): MessageKey { return networkKeys[value] ?? 'network.mainnet'; }
const rangeKeys: Readonly<Record<PortfolioRange, MessageKey>> = { '1D': 'range.1D', '7D': 'range.7D', '1M': 'range.1M', '1Y': 'range.1Y', MAX: 'range.MAX' };
type IconName = 'check' | 'chevron-right' | 'copy' | 'edit' | 'eye' | 'eye-off' | 'settings' | 'trash';
function iconMarkup(name: IconName): string { return `<svg class="icon" aria-hidden="true" focusable="false"><use href="#icon-${name}"></use></svg>`; }

function unwrapState(value: unknown): PortfolioState | null {
  if (!isRecord(value)) return null;
  if (value.ok === true && isRecord(value.value)) return value.value as unknown as PortfolioState;
  if (isRecord(value.settings) && Array.isArray(value.positions)) return { ...(value as unknown as PortfolioState), wallets: Array.isArray(value.wallets) ? value.wallets : [] };
  return null;
}

function resultFailure(value: unknown): { readonly code: string } | null {
  if (!isRecord(value) || value.ok !== false || typeof value.code !== 'string') return null;
  return { code: value.code };
}
const emptyPriceState = () => ({ quotes: [], statuses: [], valuations: [], history: [], totalEurScaled: null, totalUsdScaled: null, complete: false, valuedAssets: 0, totalAssets: 0, dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null });

export function formatRendererMoney(scaled: string | null, currency: 'EUR' | 'USD', activeLocale: LocaleCode): string {
  if (scaled === null) return '—';
  try {
    const value = scaledToDecimal(scaled); const negative = value.startsWith('-'); const unsigned = negative ? value.slice(1) : value;
    const parts = unsigned.split('.'); const whole = parts[0]!; const fraction = parts.slice(1).join('');
    let cents = BigInt(`${whole}${fraction.slice(0, 2).padEnd(2, '0')}`); if (fraction.slice(2, 3) >= '5') cents += 1n;
    const major = cents / 100n; const minor = (cents % 100n).toString().padStart(2, '0'); const separator = activeLocale === 'de' ? ',' : '.'; const grouped = new Intl.NumberFormat(activeLocale, { useGrouping: true }).format(major);
    return `${negative ? '−' : ''}${grouped}${separator}${minor} ${currency}`;
  } catch { return '—'; }
}

export function formatRendererUnitPrice(scaled: string | null, currency: 'EUR' | 'USD', activeLocale: LocaleCode): string {
  if (scaled === null) return '—';
  try {
    const decimal = scaledToDecimal(scaled); const negative = decimal.startsWith('-'); const unsigned = negative ? decimal.slice(1) : decimal;
    const parts = unsigned.split('.'); const whole = parts[0]!; const fraction = parts.slice(1).join('');
    if (whole !== '0') return formatRendererMoney(scaled, currency, activeLocale);
    const firstSignificant = fraction.search(/[1-9]/); if (firstSignificant < 0) return formatRendererMoney(scaled, currency, activeLocale);
    const precision = Math.min(12, firstSignificant + 4); const shown = fraction.slice(0, precision).replace(/0+$/, ''); const separator = activeLocale === 'de' ? ',' : '.';
    return `${negative ? '−' : ''}0${separator}${shown} ${currency}`;
  } catch { return '—'; }
}

export function formatRendererPercent(scaled: string | null, activeLocale: LocaleCode): string {
  if (scaled === null) return '—';
  const raw = BigInt(scaled); const negative = raw < 0n; const magnitude = negative ? -raw : raw; const hundredths = (magnitude + 50n) / 100n;
  const major = hundredths / 100n; const minor = (hundredths % 100n).toString().padStart(2, '0');
  return `${negative ? '−' : ''}${major}${activeLocale === 'de' ? ',' : '.'}${minor}%`;
}

export function statusToneForMessage(key: string): 'ready' | 'neutral' | 'warning' | 'busy' | 'error' {
  if (key === 'status.syncing') return 'busy';
  if (key === 'status.syncPartial' || key === 'status.syncRate') return 'warning';
  if (key === 'status.syncEmpty' || key === 'status.syncReady' || key === 'status.copyUnavailable') return 'neutral';
  if (key === 'status.syncError' || key === 'status.error' || key.startsWith('error.')) return 'error';
  return 'ready';
}

export function createRendererController(documentRef: RendererDocument, api: HoldVueApi): RendererController {
  const status = documentRef.querySelector<StatusElement>('[data-status]');
  const count = documentRef.querySelector<RendererElement>('[data-position-count]');
  const walletList = documentRef.querySelector<RendererElement>('[data-wallet-list]');
  const settingsWalletList = documentRef.querySelector<RendererElement>('[data-settings-wallet-list]');
  const holdingList = documentRef.querySelector<RendererElement>('[data-holding-list]');
  const walletDialog = documentRef.querySelector<RendererElement>('[data-wallet-dialog]');
  const walletForm = documentRef.querySelector<RendererElement>('[data-wallet-form]');
  const deleteDialog = documentRef.querySelector<RendererElement>('[data-delete-dialog]');
  const keyDeleteDialog = documentRef.querySelector<RendererElement>('[data-key-delete-dialog]');
  const settingsDialog = documentRef.querySelector<RendererElement>('[data-settings-dialog]');
  const holdingDialog = documentRef.querySelector<RendererElement>('[data-holding-dialog]');
  const holdingDeleteDialog = documentRef.querySelector<RendererElement>('[data-holding-delete-dialog]');
  const walletError = documentRef.querySelector<RendererElement>('[data-wallet-error]');
  const globalFeedback = documentRef.querySelector<RendererElement>('[data-global-feedback]');
  const settingsFeedback = documentRef.querySelector<RendererElement>('[data-settings-feedback]');
  const holdingError = documentRef.querySelector<RendererElement>('[data-holding-error]');
  let currentState: PortfolioState | null = null;
  let walletDialogMode: 'add' | 'edit' = 'add';
  let editingWalletId: string | null = null;
  let pendingDeleteId: string | null = null;
  let pendingKeyDelete: 'etherscan' | 'fmp' | null = null;
  let keyDeleteRestoreTarget: RendererElement | null = null;
  let detected: AddressMatch | null = null;
  let focusIntent: { readonly kind: 'settings' | 'priceSettings' | 'add' } | { readonly kind: 'wallet'; readonly id: string; readonly action: 'copy' | 'edit' | 'delete'; readonly scope: 'dashboard' | 'settings' } | null = null;
  let minuteDispose: (() => void) | null = null;
  let eventsBound = false;
  let detectionGeneration = 0;
  let detectionTimer: ReturnType<typeof setTimeout> | null = null;
  let holdingDialogMode: 'add' | 'edit' = 'add';
  let editingHoldingId: string | null = null;
  let pendingHoldingDeleteId: string | null = null;
  let holdingFocusIntent: { readonly kind: 'add' } | { readonly kind: 'holding'; readonly id: string; readonly action: 'edit' | 'delete' } | null = null;
  let selectedInstrument: InstrumentCandidate | null = null;
  let searchGeneration = 0;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let searchAbort = new AbortController();
  let suggestionIndex = -1;
  let portfolioRange: PortfolioRange = '1D';
  let portfolioSort: PortfolioSort = 'size';
  let expandedAssetId: string | null = null;
  const assetDisplayMode = new Map<string, 'value' | 'quantity'>();
  const assetRanges = new Map<string, PortfolioRange>();
  const chartDisposers: (() => void)[] = [];
  let resizeObserver: ResizeObserver | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  const query = (selector: string): RendererElement | null => documentRef.querySelector(selector);
  const queryAll = (selector: string): RendererElement[] => {
    const result = documentRef.querySelectorAll?.(selector) as Iterable<RendererElement> | undefined;
    if (result) return Array.from(result);
    const one = query(selector);
    return one ? [one] : [];
  };
  const providerElements = (): RendererElement[] => documentRef.querySelectorAll ? queryAll('[data-provider-id]') : [];
  const readValue = (selector: string): string => query(selector)?.value ?? '';
  const setText = (element: RendererElement | null, value: string): void => { if (element) element.textContent = value; };
  const formatMoney = (scaled: string | null, currency: 'EUR' | 'USD'): string => formatRendererMoney(scaled, currency, locale());
  const formatUnitPrice = (scaled: string | null, currency: 'EUR' | 'USD'): string => formatRendererUnitPrice(scaled, currency, locale());
  const signedMoney = (scaled: string, currency: 'EUR' | 'USD'): string => {
    return scaled.startsWith('-') ? `−${formatMoney(scaled.slice(1), currency)}` : `+${formatMoney(scaled, currency)}`;
  };
  const locale = (): LocaleCode => currentState?.settings?.locale === 'en' || (!currentState && documentRef.documentElement.lang === 'en') ? 'en' : 'de';
  const localized = (key: MessageKey): string => message(locale(), key);
  const showStatus = (key: MessageKey): void => { setText(status, localized(key)); status?.setAttribute?.('data-state', statusToneForMessage(key)); };
  const syncSummary = (state: PortfolioState): MessageKey => {
    const statuses = state.sync?.statuses ?? [];
    if (statuses.length === 0) return state.wallets.length === 0 ? 'status.syncEmpty' : 'status.syncReady';
    if (statuses.some(item => item.status === 'rate-limited')) return 'status.syncRate';
    if (statuses.some(item => item.status === 'error' || item.status === 'aborted')) return 'status.syncError';
    if (statuses.some(item => item.status === 'partial' || item.status === 'unsupported' || item.status === 'unconfigured')) return 'status.syncPartial';
    return statuses.every(item => item.status === 'empty') ? 'status.syncEmpty' : 'status.syncOk';
  };
  const syncSummaryText = (state: PortfolioState): string => {
    const successfulTimestamps = (state.sync?.statuses ?? []).map(item => item.lastSuccessAt).filter((value): value is number => typeof value === 'number');
    const lastSuccess = successfulTimestamps.length === 0 ? undefined : Math.max(...successfulTimestamps);
    const summary = localized(syncSummary(state));
    const formatted = lastSuccess === undefined ? '' : new Intl.DateTimeFormat(locale() === 'de' ? 'de-DE' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }).format(lastSuccess);
    return lastSuccess === undefined ? summary : `${summary} · ${localized('sync.last')}: ${formatted}`;
  };
  const showErrorCode = (code: string): void => {
    const text = message(locale(), errorKeys[code] ?? 'error.generic');
    if (walletError) { walletError.hidden = false; walletError.textContent = text; }
    for (const feedback of [globalFeedback, settingsFeedback]) if (feedback) { feedback.hidden = false; feedback.textContent = text; if (feedback.dataset) feedback.dataset.kind = 'error'; }
    documentRef.documentElement.dataset.state = 'error';
    if (status) { status.textContent = text; status.setAttribute?.('data-state', 'error'); }
  };
  const showSaved = (): void => {
    const text = localized('status.saved');
    for (const feedback of [globalFeedback, settingsFeedback]) if (feedback) { feedback.hidden = false; feedback.textContent = text; if (feedback.dataset) feedback.dataset.kind = 'success'; }
    showStatus('status.saved');
  };
  const clearError = (): void => {
    if (walletError) { walletError.hidden = true; walletError.textContent = ''; }
    for (const feedback of [globalFeedback, settingsFeedback]) if (feedback) { feedback.hidden = true; feedback.textContent = ''; if (feedback.dataset) delete feedback.dataset.kind; }
    if (documentRef.documentElement.dataset.state === 'error') documentRef.documentElement.dataset.state = 'ready';
  };
  const setDialogOpen = (dialog: RendererElement | null, open: boolean): void => {
    if (!dialog) return;
    if (open) { dialog.hidden = false; dialog.showModal?.(); } else { dialog.close?.(); dialog.hidden = true; }
  };
  const restore = (): void => {
    const intent = focusIntent;
    focusIntent = null;
    let target: RendererElement | null = null;
    if (intent?.kind === 'settings') target = query('[data-open-settings]');
    if (intent?.kind === 'priceSettings') target = query('[data-price-source-setup]');
    if (intent?.kind === 'add') target = query('[data-add-wallet]');
    if (intent?.kind === 'wallet') {
      const sourceList = (intent.scope === 'settings' ? settingsWalletList : walletList)!;
      const actionButtons = Array.from(sourceList.querySelectorAll!('[data-wallet-action]') as Iterable<RendererElement>);
      target = actionButtons.find(button => button.getAttribute?.('data-wallet-id') === intent.id && button.getAttribute?.('data-wallet-action') === intent.action) as RendererElement | null;
    }
    (target ?? (intent?.kind === 'wallet' && intent.scope === 'settings' ? query('[data-settings-close]') : null) ?? query('[data-add-wallet]') ?? query('[data-open-settings]'))?.focus?.();
  };
  const showControllerError = (): void => { documentRef.documentElement.dataset.state = 'error'; showErrorCode('generic'); showStatus('status.error'); };
  const applyStaticLocale = (): void => {
    const activeLocale = locale();
    for (const element of queryAll('[data-i18n]')) {
      const key = element.getAttribute?.('data-i18n') as MessageKey | null;
      if (key && key in messages[activeLocale]) element.textContent = message(activeLocale, key);
    }
    for (const element of queryAll('[data-i18n-aria-label]')) {
      const key = element.getAttribute?.('data-i18n-aria-label') as MessageKey | null;
      if (key) element.setAttribute?.('aria-label', message(activeLocale, key));
    }
    for (const element of queryAll('[data-i18n-placeholder]')) {
      const key = element.getAttribute?.('data-i18n-placeholder') as MessageKey | null;
      if (key) element.setAttribute?.('placeholder', message(activeLocale, key));
    }
    for (const element of queryAll('[data-i18n-title]')) {
      const key = element.getAttribute?.('data-i18n-title') as MessageKey | null | undefined;
      if (key) element.setAttribute?.('title', message(activeLocale, key));
    }
    const footer = query('[data-footer-summary]');
    if (!footer) return;
    const state = currentState as PortfolioState;
    setText(footer, `${state.settings.currency} · ${state.settings.locale.toUpperCase()} · ${message(activeLocale, state.settings.theme === 'light' ? 'footer.theme.light' : 'footer.theme.dark')}`);
  };
  const walletCards = (wallets: readonly WalletSource[]): string => wallets.length === 0
    ? `<p class="wallet-empty" data-i18n="wallet.empty">${escapeHtml(localized('wallet.empty'))}</p>`
    : wallets.map(wallet => {
      const network = 'network' in wallet.options ? message(locale(), networkKey(wallet.options.network)) : wallet.family === 'evm' ? (wallet.options.autoScanCommonChains ? localized('wallet.allChains') : localized('wallet.selectedChains')) : '';
      const family = wallet.family === 'evm' ? 'EVM' : wallet.family === 'bitcoin' ? 'Bitcoin' : wallet.family === 'solana' ? 'Solana' : 'Cardano';
      const activity = wallet.enabled ? localized('wallet.active') : localized('wallet.disabled');
      const copyLabel = `${localized('button.copy')} ${localized('wallet.addressFor')} ${wallet.label}`;
      const editLabel = `${localized('button.edit')} ${wallet.label}`;
      const deleteLabel = `${localized('button.delete')} ${wallet.label}`;
      return `<article class="wallet-card" data-wallet-id="${escapeHtml(wallet.id)}"><div class="wallet-card-main"><h3>${escapeHtml(wallet.label)}</h3><p class="wallet-meta">${escapeHtml(family)} · ${escapeHtml(network)} · ${escapeHtml(activity)}</p><code class="wallet-address" title="${escapeHtml(wallet.address)}" aria-label="${escapeHtml(wallet.address)}">${escapeHtml(wallet.address)}</code></div><div class="wallet-actions"><button type="button" class="secondary compact-action" data-wallet-action="copy" data-wallet-id="${escapeHtml(wallet.id)}" aria-label="${escapeHtml(copyLabel)}">${iconMarkup('copy')}<span>${escapeHtml(localized('button.copy'))}</span></button><button type="button" class="secondary compact-action" data-wallet-action="edit" data-wallet-id="${escapeHtml(wallet.id)}" aria-label="${escapeHtml(editLabel)}">${iconMarkup('edit')}<span>${escapeHtml(localized('button.edit'))}</span></button><button type="button" class="danger compact-action" data-wallet-action="delete" data-wallet-id="${escapeHtml(wallet.id)}" aria-label="${escapeHtml(deleteLabel)}">${iconMarkup('trash')}<span>${escapeHtml(localized('button.delete'))}</span></button></div></article>`;
    }).join('');
  const renderWalletList = (element: RendererElement | null, wallets: readonly WalletSource[], scope: 'dashboard' | 'settings'): void => {
    if (!element || typeof element.innerHTML !== 'string') return;
    const focusedWalletId = documentRef.activeElement?.getAttribute?.('data-wallet-id') ?? null;
    const focusedWalletAction = documentRef.activeElement?.getAttribute?.('data-wallet-action') ?? null;
    element.innerHTML = walletCards(wallets);
    for (const button of typeof element.querySelectorAll === 'function' ? Array.from(element.querySelectorAll('[data-wallet-action]') as Iterable<RendererElement>) : []) {
      const action = button.getAttribute?.('data-wallet-action');
      const id = button.getAttribute?.('data-wallet-id');
      if (!action || !id || !button.addEventListener) continue;
      if (action === 'copy') button.addEventListener('click', event => { event.preventDefault(); void copyWallet(id); });
      if (action === 'edit') button.addEventListener('click', event => { event.preventDefault(); if (scope === 'dashboard') openEdit(id); else openEdit(id, scope); });
      if (action === 'delete') button.addEventListener('click', event => { event.preventDefault(); if (scope === 'dashboard') openDelete(id); else openDelete(id, scope); });
    }
    if (focusedWalletId && focusedWalletAction) Array.from(element.querySelectorAll!('[data-wallet-action]') as Iterable<RendererElement>).find(button => button.getAttribute?.('data-wallet-id') === focusedWalletId && button.getAttribute?.('data-wallet-action') === focusedWalletAction)?.focus?.();
  };
  const showHoldingError = (code: string): void => { holdingError!.hidden = false; holdingError!.textContent = message(locale(), errorKeys[code] ?? 'error.generic'); };
  const clearHoldingError = (): void => { if (holdingError) { holdingError.hidden = true; holdingError.textContent = ''; } };
  const fmpIsConfigured = (state: PortfolioState): boolean => (state.settings.providerRefs ?? []).some(reference => reference.providerId === 'fmp.market' && reference.keyId !== null && reference.enabled);
  const priceSourceConfigured = (state: PortfolioState): boolean => (state.settings.providerRefs ?? []).find(reference => reference.providerId === 'yahoo.finance')?.enabled !== false;
  const providerName = (providerId: string): string => providerId === 'yahoo.finance' ? 'Yahoo Finance' : providerId === 'fmp.market' ? 'FMP' : providerId === 'coingecko.keyless' ? 'CoinGecko' : localized('portfolio.priceSource');
  const openPriceSettings = (): void => {
    focusIntent = { kind: 'priceSettings' };
    setDialogOpen(settingsDialog, true);
    (query('[data-provider-id="yahoo.finance"]') ?? query('[data-fmp-key]'))?.focus?.();
  };
  const priceStatusText = (status: PortfolioState['prices']['statuses'][number] | undefined, hasQuote: boolean): string => {
    if (hasQuote && status?.status === 'stale') return localized('portfolio.priceStale');
    if (status?.errorCode === 'unconfigured') return localized('portfolio.priceUnconfigured');
    if (status?.errorCode === 'missing-quote' || !status) return localized('portfolio.priceMissing');
    if (status.status === 'partial') return localized('portfolio.pricePartial');
    if (status.status === 'rate-limited') return localized('portfolio.priceRateLimited');
    if (status.status === 'error' || status.status === 'aborted') return localized('portfolio.priceError');
    return localized('portfolio.unpriced');
  };
  const holdingCards = (state: PortfolioState): string => {
    const prices = state.prices ?? emptyPriceState();
    const holdings = Array.isArray(state.holdings) ? state.holdings : [];
    const instruments = Array.isArray(state.instruments) ? state.instruments : [];
    if (holdings.length === 0) return `<p class="holding-empty" data-i18n="holdings.empty">${escapeHtml(localized('holdings.empty'))}</p>`;
    return holdings.map(holding => {
      const instrument = instruments.find(item => item.id === holding.instrumentId);
      if (!instrument) return '';
      const valuation = prices.valuations.find(item => item.assetId === `instrument:${instrument.id}`);
      const quote = prices.quotes.find(item => item.assetId === `instrument:${instrument.id}`);
      const status = prices.statuses.find(item => item.assetId === `instrument:${instrument.id}`);
      const quotedPrice = quote ? formatUnitPrice(state.settings.currency === 'EUR' ? quote.priceEurScaled : quote.priceUsdScaled, state.settings.currency) : null;
      const hasQuote = quotedPrice !== null && quotedPrice !== '—';
      const effectiveStatus = status ?? (!hasQuote && !priceSourceConfigured(state) ? { assetId: `instrument:${instrument.id}`, providerId: 'yahoo.finance', status: 'unpriced' as const, errorCode: 'unconfigured', lastGoodFetchedAt: null } : undefined);
      const price = hasQuote ? quotedPrice : priceStatusText(effectiveStatus, false);
      const value = valuation ? formatMoney(state.settings.currency === 'EUR' ? valuation.valueEurScaled : valuation.valueUsdScaled, state.settings.currency) : null;
      const setup = !hasQuote && effectiveStatus?.errorCode === 'unconfigured' ? `<button type="button" class="secondary holding-price-action compact-action" data-price-source-setup aria-label="${escapeHtml(localized('portfolio.setupPriceSource'))}">${iconMarkup('settings')}<span>${escapeHtml(localized('portfolio.setupPriceSource'))}</span></button>` : '';
      const statusNote = hasQuote && effectiveStatus?.status === 'stale' ? priceStatusText(effectiveStatus, true) : '';
      const sourceNote = hasQuote && quote ? providerName(quote.source) : '';
      const valueText = value === null ? '' : ` · ${value}`;
      const editLabel = `${localized('button.edit')} ${instrument.name}`;
      const deleteLabel = `${localized('button.delete')} ${instrument.name}`;
      return `<article class="holding-card" data-holding-id="${escapeHtml(holding.id)}"><div><h3>${escapeHtml(instrument.name)}</h3><p class="holding-meta">${escapeHtml(instrument.symbol)} · ${escapeHtml(instrument.exchange)} · ${escapeHtml(instrument.currency)} · ${escapeHtml(instrument.type.toUpperCase())}</p><p class="holding-quantity"><span>${escapeHtml(localized('holdings.quantity'))}</span> <strong>${escapeHtml(holding.quantity)}</strong></p><p class="holding-meta holding-price-status"><span>${escapeHtml(price)}${valueText}</span>${sourceNote ? `<small class="price-source">${escapeHtml(sourceNote)}</small>` : ''}${setup}${statusNote ? `<small>${escapeHtml(statusNote)}</small>` : ''}</p></div><div class="holding-actions"><button type="button" class="secondary compact-action" data-holding-action="edit" data-holding-id="${escapeHtml(holding.id)}" aria-label="${escapeHtml(editLabel)}">${iconMarkup('edit')}<span>${escapeHtml(localized('button.edit'))}</span></button><button type="button" class="danger compact-action" data-holding-action="delete" data-holding-id="${escapeHtml(holding.id)}" aria-label="${escapeHtml(deleteLabel)}">${iconMarkup('trash')}<span>${escapeHtml(localized('button.delete'))}</span></button></div></article>`;
    }).join('');
  };
  const renderHoldingList = (state: PortfolioState): void => {
    if (!holdingList || typeof holdingList.innerHTML !== 'string') return;
    const focusedHoldingId = documentRef.activeElement?.getAttribute?.('data-holding-id') ?? null;
    const focusedHoldingAction = documentRef.activeElement?.getAttribute?.('data-holding-action') ?? null;
    holdingList.innerHTML = holdingCards(state);
    for (const button of Array.from(holdingList.querySelectorAll!('[data-holding-action]') as Iterable<RendererElement>)) {
      const action = button.getAttribute?.('data-holding-action');
      const id = button.getAttribute?.('data-holding-id');
      if (action === 'edit') button.addEventListener!('click', event => { event.preventDefault(); openHolding('edit', id!); });
      if (action === 'delete') button.addEventListener!('click', event => { event.preventDefault(); openHoldingDelete(id!); });
    }
    for (const button of Array.from(holdingList.querySelectorAll!('[data-price-source-setup]') as Iterable<RendererElement>)) button.addEventListener!('click', event => { event.preventDefault(); openPriceSettings(); });
    if (focusedHoldingId && focusedHoldingAction) Array.from(holdingList.querySelectorAll!('[data-holding-action]') as Iterable<RendererElement>).find(button => button.getAttribute?.('data-holding-id') === focusedHoldingId && button.getAttribute?.('data-holding-action') === focusedHoldingAction)?.focus?.();
  };
  const holdingRestore = (): void => {
    const intent = holdingFocusIntent;
    holdingFocusIntent = null;
    let target: RendererElement | null = null;
    if (intent?.kind === 'add') target = query('[data-add-holding]');
    if (intent?.kind === 'holding') {
      target = Array.from(holdingList!.querySelectorAll!('[data-holding-action]') as Iterable<RendererElement>).find(button => button.getAttribute?.('data-holding-id') === intent.id && button.getAttribute?.('data-holding-action') === intent.action) as RendererElement | null;
    }
    (target ?? query('[data-add-holding]') ?? query('[data-open-settings]'))?.focus?.();
  };
  const hideSuggestions = (): void => {
    const list = query('[data-instrument-suggestions]');
    if (list) { list.hidden = true; list.innerHTML = ''; }
    const input = query('[data-instrument-search]');
    input?.setAttribute?.('aria-expanded', 'false');
    input?.setAttribute?.('aria-activedescendant', '');
    suggestionIndex = -1;
  };
  const chooseInstrument = (candidate: InstrumentCandidate): void => {
    selectedInstrument = candidate;
    const input = query('[data-instrument-search]');
    if (input) input.value = `${candidate.symbol} · ${candidate.name}`;
    const typeLabel = { unknown: localized('holdings.typePending'), stock: 'STOCK', etf: 'ETF' }[candidate.type];
    setText(query('[data-selected-instrument]'), `${candidate.symbol} · ${candidate.exchange} · ${candidate.currency} · ${typeLabel}`);
    const hint = candidate.providerId === 'fmp.market'
      ? (fmpIsConfigured(currentState!) ? localized('settings.fmpConfigured') : localized('settings.fmpNotConfigured'))
      : (priceSourceConfigured(currentState!) ? localized('holdings.localPriceActiveHint') : localized('holdings.localPriceHint'));
    setText(query('[data-instrument-price-hint]'), hint);
    hideSuggestions();
    clearHoldingError();
  };
  const renderSuggestions = (candidates: readonly InstrumentCandidate[]): void => {
    const list = query('[data-instrument-suggestions]');
    if (!list) return;
    if (candidates.length === 0) { hideSuggestions(); query('[data-instrument-status]')!.textContent = localized('holdings.noResults'); return; }
    list.innerHTML = candidates.map((candidate, index) => { const provider = candidate.providerId === 'holdvue.catalog' ? localized('holdings.localCatalog') : providerName(candidate.providerId); return `<li id="instrument-option-${index}" role="option" data-instrument-index="${index}" aria-selected="false"><strong>${escapeHtml(candidate.name)}</strong><span>${escapeHtml(candidate.symbol)} · ${escapeHtml(candidate.exchange)} · ${escapeHtml(candidate.currency)} · ${escapeHtml(candidate.type === 'unknown' ? localized('holdings.typePending') : candidate.type.toUpperCase())} · ${escapeHtml(provider)}</span><span class="suggestion-check" aria-hidden="true">${iconMarkup('check')}</span></li>`; }).join('');
    list.hidden = false;
    query('[data-instrument-search]')?.setAttribute?.('aria-expanded', 'true');
    for (const item of Array.from(list.querySelectorAll!('[data-instrument-index]') as Iterable<RendererElement>)) item.addEventListener!('click', event => { event.preventDefault(); const index = Number(item.getAttribute!('data-instrument-index')); const candidate = candidates[index]; if (candidate) chooseInstrument(candidate); });
  };
  const performInstrumentSearch = async (queryText: string, generation: number, controller: AbortController): Promise<void> => {
    try {
      const result = await api.searchInstruments(queryText);
      if (generation !== searchGeneration || controller.signal.aborted) return;
      const error = resultFailure(result);
      if (error) { hideSuggestions(); showHoldingError(error.code); query('[data-instrument-status]')!.textContent = ''; return; }
      if (!isRecord(result) || result.ok !== true || !Array.isArray(result.value)) { hideSuggestions(); showHoldingError('search-failed'); return; }
      clearHoldingError();
      query('[data-instrument-status]')!.textContent = '';
      renderSuggestions(result.value as readonly InstrumentCandidate[]);
    } catch {
      if (generation === searchGeneration && !controller.signal.aborted) { hideSuggestions(); showHoldingError('search-failed'); }
    }
  };
  const scheduleInstrumentSearch = (): void => {
    const value = readValue('[data-instrument-search]').trim();
    selectedInstrument = null;
    setText(query('[data-selected-instrument]'), '');
    setText(query('[data-instrument-price-hint]'), '');
    clearHoldingError();
    searchGeneration += 1;
    searchAbort.abort();
    if (searchTimer !== null) clearTimeout(searchTimer);
    hideSuggestions();
    if (value === '') return;
    query('[data-instrument-status]')!.textContent = '…';
    const generation = searchGeneration;
    const controller = new AbortController();
    searchAbort = controller;
    searchTimer = setTimeout(() => { searchTimer = null; void performInstrumentSearch(value, generation, controller); }, 300);
  };
  const instrumentKeydown = (event: Event): void => {
    const key = (event as KeyboardEvent).key;
    const list = query('[data-instrument-suggestions]');
    const items = Array.from(list?.querySelectorAll?.('[data-instrument-index]') as Iterable<RendererElement> ?? []);
    if (key === 'Escape') { searchAbort.abort(); hideSuggestions(); return; }
    if (key === 'ArrowDown' && items.length > 0) { event.preventDefault(); suggestionIndex = Math.min(suggestionIndex + 1, items.length - 1); }
    else if (key === 'ArrowUp' && items.length > 0) { event.preventDefault(); suggestionIndex = Math.max(suggestionIndex - 1, 0); }
    else if (key === 'Enter' && suggestionIndex >= 0) { event.preventDefault(); const item = items[suggestionIndex]; item?.click?.(); return; }
    items.forEach((item, index) => item.setAttribute?.('aria-selected', index === suggestionIndex ? 'true' : 'false'));
    const active = items[suggestionIndex];
    query('[data-instrument-search]')?.setAttribute?.('aria-activedescendant', active?.getAttribute?.('id') ?? '');
  };
  const openHolding = (mode: 'add' | 'edit', id?: string): void => {
    holdingDialogMode = mode;
    editingHoldingId = id ?? null;
    selectedInstrument = null;
    clearHoldingError();
    hideSuggestions();
    const search = query('[data-instrument-search]');
    const searchField = query('[data-instrument-search-field]');
    const quantity = query('[data-holding-quantity]');
    const holding = id && currentState ? currentState.holdings.find(item => item.id === id) : undefined;
    const instrument = holding && currentState ? currentState.instruments.find(item => item.id === holding.instrumentId) : undefined;
    if (instrument) {
      selectedInstrument = instrument;
      if (search) { search.value = `${instrument.symbol} · ${instrument.name}`; search.disabled = true; }
      setText(query('[data-selected-instrument]'), `${instrument.name} · ${instrument.symbol} · ${instrument.exchange} · ${instrument.currency} · ${instrument.type.toUpperCase()}`);
      const hint = instrument.providerId === 'fmp.market'
        ? (fmpIsConfigured(currentState!) ? localized('settings.fmpConfigured') : localized('settings.fmpNotConfigured'))
        : (priceSourceConfigured(currentState!) ? localized('holdings.localPriceActiveHint') : localized('holdings.localPriceHint'));
      setText(query('[data-instrument-price-hint]'), hint);
      quantity!.value = holding!.quantity;
      holdingFocusIntent = { kind: 'holding', id: id!, action: 'edit' };
    } else {
      if (search) { search.value = ''; search.disabled = false; }
      if (quantity) quantity.value = '';
      setText(query('[data-instrument-price-hint]'), '');
      holdingFocusIntent = { kind: 'add' };
    }
    if (searchField) searchField.hidden = mode === 'edit';
    setText(query('[data-holding-dialog-title]'), localized(mode === 'edit' ? 'holdings.edit' : 'holdings.add'));
    setDialogOpen(holdingDialog, true);
    if (!instrument) search?.focus?.(); else quantity?.focus?.();
  };
  const openHoldingDelete = (id: string): void => {
    const holding = currentState?.holdings.find(item => item.id === id);
    const instrument = holding && currentState?.instruments.find(item => item.id === holding.instrumentId);
    if (!holding || !instrument) return;
    pendingHoldingDeleteId = id;
    holdingFocusIntent = { kind: 'holding', id, action: 'delete' };
    setText(query('[data-delete-holding-label]'), instrument.name);
    setDialogOpen(holdingDeleteDialog, true);
    query('[data-holding-delete-cancel]')?.focus?.();
  };
  const setEvmControls = (): void => {
    const allCommon = query('[data-wallet-all-evm]')?.checked !== false;
    const chainGrid = query('[data-evm-chains]');
    if (chainGrid) { chainGrid.hidden = allCommon; chainGrid.setAttribute?.('aria-hidden', String(allCommon)); }
    const allToggle = query('[data-wallet-all-evm]');
    allToggle?.setAttribute?.('aria-expanded', String(!allCommon));
    for (const input of queryAll('[data-chain-id]')) input.disabled = allCommon;
  };
  const setSettingControls = (settings: Settings): void => {
    const values: readonly [string, string | boolean][] = [['[data-setting-currency]', settings.currency], ['[data-setting-locale]', settings.locale], ['[data-setting-theme]', settings.theme], ['[data-setting-scheduler]', settings.schedulerEnabled], ['[data-setting-spam]', settings.spamFilterEnabled], ['[data-setting-hidden-spam]', settings.showHiddenSpamAssets]];
    for (const [selector, value] of values) { const element = query(selector); if (!element) continue; if (typeof value === 'boolean') element.checked = value; else element.value = value; }
    const enabledProviders = new Set(settings.enabledProviderIds ?? []);
    const keylessRefs = new Map((settings.providerRefs ?? []).filter(reference => reference.providerId === 'yahoo.finance' || reference.providerId === 'coingecko.keyless').map(reference => [reference.providerId, reference.enabled]));
    for (const provider of providerElements()) { const id = provider.getAttribute!('data-provider-id')!; provider.checked = id === 'yahoo.finance' || id === 'coingecko.keyless' ? keylessRefs.get(id) !== false : enabledProviders.has(id); }
    const keyConfigured = (settings.providerRefs ?? []).some(reference => reference.providerId === 'evm.erc20' && reference.keyId !== null && reference.enabled);
    setText(query('[data-etherscan-key-status]'), localized(keyConfigured ? 'settings.keyConfigured' : 'settings.keyNotConfigured'));
    const fmpConfigured = (settings.providerRefs ?? []).some(reference => reference.providerId === 'fmp.market' && reference.keyId !== null && reference.enabled);
    const yahooEnabled = (settings.providerRefs ?? []).find(reference => reference.providerId === 'yahoo.finance')?.enabled !== false;
    setText(query('[data-fmp-key-status]'), localized(fmpConfigured ? 'settings.fmpConfigured' : yahooEnabled ? 'settings.fmpNotConfigured' : 'holdings.fmpPriceHint'));
    const solanaEndpoint = (settings.providerEndpoints ?? []).find(endpoint => endpoint.providerId === 'solana.rpc')?.endpoint ?? '';
    const solanaInput = query('[data-provider-endpoint="solana.rpc"]'); if (solanaInput) solanaInput.value = solanaEndpoint;
    const overrides = new Map((settings.rpcOverrides ?? []).map(override => [String(override.chainId), override.rpcUrl]));
    for (const input of queryAll('[data-rpc-chain-id]')) input.value = overrides.get(input.getAttribute?.('data-rpc-chain-id') ?? '') ?? '';
  };
  const percentText = (scaled: string | null): string => formatRendererPercent(scaled, locale());
  const portfolioRangeSummary = (points: readonly { readonly timestamp: number; readonly valueEurScaled: string; readonly valueUsdScaled: string }[], currency: 'EUR' | 'USD'): string => {
    if (points.length < 2) return '';
    const first = currency === 'EUR' ? points[0]!.valueEurScaled : points[0]!.valueUsdScaled;
    const last = currency === 'EUR' ? points.at(-1)!.valueEurScaled : points.at(-1)!.valueUsdScaled;
    const delta = (BigInt(last) - BigInt(first)).toString();
    const percent = BigInt(first) === 0n ? null : ((BigInt(delta) * 1000000n) / BigInt(first)).toString();
    return `${delta.startsWith('-') ? '−' : '+'}${formatMoney(delta.startsWith('-') ? delta.slice(1) : delta, currency)} · ${percentText(percent)}`;
  };
  const assetRow = (asset: PortfolioAssetView, currency: 'EUR' | 'USD'): string => {
    const mode = assetDisplayMode.get(asset.assetId) ?? 'value';
    const primary = mode === 'value' ? formatMoney(asset.valueScaled, currency) : asset.quantity;
    const toggleLabel = mode === 'value' ? localized('portfolio.showQuantity') : localized('portfolio.showValue');
    const change = asset.dayChangeScaled === null ? localized('portfolio.unpriced') : `${signedMoney(asset.dayChangeScaled, currency)} · ${percentText(asset.dayChangePercentScaled)}`;
    const expanded = expandedAssetId === asset.assetId;
    const chartId = `asset-chart-${asset.assetId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    const accounts = expanded ? `<aside class="account-breakdown"><div class="account-title"><h4>${escapeHtml(localized('portfolio.account'))}</h4><span>${asset.accounts.length}</span></div><div class="account-row account-header"><span>${escapeHtml(localized('portfolio.account'))}</span><span>${escapeHtml(localized('portfolio.balance'))}</span><span>${escapeHtml(localized('portfolio.value'))}</span></div>${asset.accounts.map(account => `<div class="account-row"><span><strong>${escapeHtml(account.label)}</strong><small>${escapeHtml(account.chain)}</small><code title="${escapeHtml(account.address)}">${escapeHtml(account.address)}</code></span><span>${escapeHtml(account.quantity)}</span><span>${escapeHtml(formatMoney(account.valueScaled, currency))}</span></div>`).join('')}</aside>` : '';
    const assetRange = assetRanges.get(asset.assetId) ?? portfolioRange;
    const rangeButtons = (['1D', '7D', '1M', '1Y', 'MAX'] as const).map(range => `<button type="button" class="range-button" data-asset-range="${escapeHtml(asset.assetId)}" data-range="${range}" aria-pressed="${assetRange === range}">${escapeHtml(localized(rangeKeys[range]))}</button>`).join('');
    const expandedPanel = expanded ? `<div class="asset-expanded" id="${escapeHtml(chartId)}"><section class="asset-detail-chart"><div class="asset-detail-heading"><div><span class="chart-label">${escapeHtml(localized('portfolio.assetPriceHistory'))}</span><p class="asset-range-kpi" data-asset-range-summary="${escapeHtml(asset.assetId)}"></p></div><div class="chart-toolbar" role="group" aria-label="${escapeHtml(localized('portfolio.chartRange'))}">${rangeButtons}</div></div><div class="chart-shell asset-chart" data-asset-chart tabindex="0" role="group" aria-label="${escapeHtml(asset.name)}"></div></section>${accounts}</div>` : '';
    const hideLabel = `${localized('portfolio.hide')} · ${asset.name}`;
    const deleteLabel = `${localized('button.delete')} · ${asset.name}`;
    const hideButton = asset.kind === 'wallet' ? `<button type="button" class="icon-button asset-hide-button" data-asset-hide="${escapeHtml(asset.assetId)}" aria-label="${escapeHtml(hideLabel)}" title="${escapeHtml(hideLabel)}">${iconMarkup('eye-off')}</button>` : `<button type="button" class="icon-button danger" data-portfolio-holding-delete="${escapeHtml(asset.accounts[0]!.id)}" aria-label="${escapeHtml(deleteLabel)}" title="${escapeHtml(deleteLabel)}">${iconMarkup('trash')}</button>`;
    return `<article class="asset-row${expanded ? ' is-expanded' : ''}" data-asset-id="${escapeHtml(asset.assetId)}"><div class="asset-main"><button type="button" class="asset-disclosure" data-asset-disclosure="${escapeHtml(asset.assetId)}" aria-expanded="${expanded ? 'true' : 'false'}"${expanded ? ` aria-controls="${escapeHtml(chartId)}"` : ''}><span class="disclosure-chevron" aria-hidden="true">${iconMarkup('chevron-right')}</span><span class="asset-identity"><strong>${escapeHtml(asset.name)}</strong><span><b>${escapeHtml(asset.symbol)}</b><small>${escapeHtml(asset.source.replace('Multiple accounts', localized('portfolio.multipleAccounts')))}</small></span></span></button></div><div class="asset-meta"><span class="asset-price" data-mobile-label="${escapeHtml(localized('portfolio.unitPrice'))}">${escapeHtml(formatUnitPrice(asset.priceScaled, currency))}</span><span class="asset-change${asset.dayChangeScaled?.startsWith('-') ? ' negative' : asset.dayChangeScaled === null ? '' : ' positive'}" data-mobile-label="24H">${escapeHtml(change)}</span><button type="button" class="asset-value-button" data-asset-toggle="${escapeHtml(asset.assetId)}" aria-label="${escapeHtml(toggleLabel)}" title="${escapeHtml(toggleLabel)}" data-mobile-label="${escapeHtml(localized('portfolio.value'))}">${escapeHtml(primary)}</button>${hideButton}</div>${expandedPanel}</article>`;
  };
  const renderPortfolio = (state: PortfolioState): void => {
    const focusedAssetDisclosure = documentRef.activeElement?.getAttribute?.('data-asset-disclosure') ?? null;
    const focusedRangeAsset = documentRef.activeElement?.getAttribute?.('data-asset-range') ?? null;
    const focusedRange = documentRef.activeElement?.getAttribute?.('data-range') ?? null;
    const focusedAssetToggle = documentRef.activeElement?.getAttribute?.('data-asset-toggle') ?? null;
    const focusedAssetAction = documentRef.activeElement?.getAttribute?.('data-asset-hide') ?? documentRef.activeElement?.getAttribute?.('data-portfolio-holding-delete') ?? null;
    const normalized = { ...state, settings: { ...state.settings, hiddenAssetIds: state.settings.hiddenAssetIds ?? [] }, instruments: state.instruments ?? [], holdings: state.holdings ?? [], prices: state.prices ?? emptyPriceState() } as PortfolioState;
    const model = buildPortfolioViewModel(normalized);
    const currency = normalized.settings.currency;
    const portfolioTotal = query('[data-portfolio-total]'); const portfolioDay = query('[data-portfolio-day]'); const portfolioValued = query('[data-portfolio-valued]');
    if (portfolioTotal !== count) setText(portfolioTotal, formatMoney(model.summary.totalScaled, currency));
    const day = model.summary.dayChangeScaled === null ? '—' : `${signedMoney(model.summary.dayChangeScaled, currency)} · ${percentText(model.summary.dayChangePercentScaled)}`;
    if (portfolioDay && portfolioDay !== count) { setText(portfolioDay, day); portfolioDay.className = `portfolio-day${model.summary.dayChangeScaled?.startsWith('-') ? ' negative' : model.summary.dayChangeScaled === null ? '' : ' positive'}`; }
    if (portfolioValued !== count) setText(portfolioValued, `${model.summary.valuedAssets}/${model.summary.totalAssets}`);
    for (const button of queryAll('[data-currency-switch]')) { const active = button.getAttribute?.('data-currency-switch') === currency; button.setAttribute?.('aria-pressed', String(active)); button.className = active ? 'secondary active' : 'secondary'; }
    for (const button of queryAll('[data-portfolio-range]')) { const active = button.getAttribute?.('data-portfolio-range') === portfolioRange; button.setAttribute?.('aria-pressed', String(active)); button.className = active ? 'range-button active' : 'range-button'; }
    for (const button of queryAll('[data-portfolio-sort]')) { const active = button.getAttribute?.('data-portfolio-sort') === portfolioSort; button.setAttribute?.('aria-pressed', String(active)); button.className = active ? 'range-button active' : 'range-button'; }
    const portfolioHost = query('[data-portfolio-chart-content]');
    const portfolioSeries = normalized.prices.history.find(series => series.id === 'portfolio' && series.kind === 'portfolio-value');
    const points = selectHistoryPoints(portfolioSeries?.points ?? [], portfolioRange, Math.max(...(portfolioSeries?.points ?? []).map(point => point.timestamp), Date.now()));
    const chartConfig = { points, currency, range: portfolioRange, title: `${localized('portfolio.history')} · ${currency}`, summary: points.length === 0 ? (portfolioSeries ? localized('portfolio.rangeEmpty') : localized('portfolio.chartEmpty')) : points.length === 1 ? localized('portfolio.chartTooShort') : localized('portfolio.history'), unit: 'value' as const, height: 240, width: portfolioHost?.clientWidth };
    chartDisposers.splice(0).forEach(dispose => dispose());
    if (portfolioHost && portfolioHost !== count) { const dispose = bindChart(portfolioHost as never, chartConfig, locale(), (index, tooltip) => { const tip = portfolioHost.querySelector?.('[data-chart-tooltip]'); if (tip) { tip.hidden = tooltip === ''; tip.textContent = tooltip; if (tip.dataset) tip.dataset.side = index !== null && index > points.length / 2 ? 'left' : 'right'; } }); chartDisposers.push(dispose); }
    if (portfolioHost && portfolioHost !== count && typeof ResizeObserver !== 'undefined' && !resizeObserver) { resizeObserver = new ResizeObserver(() => { if (resizeTimer !== null) clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { resizeTimer = null; if (currentState) renderPortfolio(currentState); }, 80); }); resizeObserver.observe(portfolioHost as unknown as Element); }
    const rangeSummary = query('[data-portfolio-range-summary]'); if (rangeSummary !== count) setText(rangeSummary, portfolioRangeSummary(points, currency));
    const list = query('[data-asset-list]');
    if (list && list !== count) { const sorted = sortPortfolioAssets(model.assets, portfolioSort); list.innerHTML = sorted.length === 0 ? `<p class="holding-empty">${escapeHtml(localized('portfolio.empty'))}</p>` : sorted.map(asset => assetRow(asset, currency)).join(''); }
    const hiddenMarkup = model.hiddenAssets.map(asset => `<div class="hidden-asset-row"><span>${escapeHtml(asset.name)} · ${escapeHtml(asset.symbol)}</span><button type="button" class="secondary compact-action" data-asset-restore="${escapeHtml(asset.assetId)}">${iconMarkup('eye')}<span>${escapeHtml(localized('portfolio.restore'))}</span></button></div>`).join('');
    for (const section of queryAll('[data-hidden-assets], [data-settings-hidden-assets]')) { const list = section.querySelector?.('[data-hidden-asset-list], [data-settings-hidden-asset-list]'); if (section !== count && list && list !== count) { section.hidden = model.hiddenAssets.length === 0; list.innerHTML = hiddenMarkup; } }
    const assetHost = query('[data-asset-chart]');
    if (assetHost && assetHost !== count && expandedAssetId) {
      const assetSeries = normalized.prices.history.find(series => series.id === expandedAssetId && series.kind === 'asset-price');
      const assetRange = assetRanges.get(expandedAssetId) ?? portfolioRange;
      const assetPoints = selectHistoryPoints(assetSeries?.points ?? [], assetRange, Math.max(...(assetSeries?.points ?? []).map(point => point.timestamp), Date.now()));
      const asset = model.assets.find(item => item.assetId === expandedAssetId);
      const assetKpi = queryAll('[data-asset-range-summary]').find(element => element.getAttribute!('data-asset-range-summary') === expandedAssetId);
      if (assetKpi) setText(assetKpi, assetPoints.length < 2 ? '' : portfolioRangeSummary(assetPoints, currency));
      const dispose = bindChart(assetHost as never, { points: assetPoints, currency, range: assetRange, title: `${asset!.name} · ${localized('portfolio.unitPrice')}`, summary: assetPoints.length === 0 ? (assetSeries ? localized('portfolio.rangeEmpty') : localized('portfolio.chartEmpty')) : assetPoints.length === 1 ? localized('portfolio.chartTooShort') : localized('portfolio.assetPriceHistory'), unit: 'price', height: 160, width: assetHost.clientWidth }, locale(), (index, tooltip) => { const tip = assetHost.querySelector?.('[data-chart-tooltip]'); if (tip) { tip.hidden = tooltip === ''; tip.textContent = tooltip; if (tip.dataset) tip.dataset.side = index !== null && index > assetPoints.length / 2 ? 'left' : 'right'; } }); chartDisposers.push(dispose);
    }
    for (const button of queryAll('[data-asset-disclosure]')) bind(button, 'click', event => { event.preventDefault(); const id = button.getAttribute!('data-asset-disclosure')!; expandedAssetId = expandedAssetId === id ? null : id; renderPortfolio(currentState!); });
    for (const button of queryAll('[data-asset-toggle]')) bind(button, 'click', event => { event.preventDefault(); const id = button.getAttribute!('data-asset-toggle')!; assetDisplayMode.set(id, assetDisplayMode.get(id) === 'quantity' ? 'value' : 'quantity'); renderPortfolio(currentState!); });
    for (const button of queryAll('[data-asset-hide]')) bind(button, 'click', event => { event.preventDefault(); const id = button.getAttribute!('data-asset-hide')!; void persistSetting('hiddenAssetIds', [...new Set([...(currentState!.settings.hiddenAssetIds ?? []), id])]); });
    for (const button of queryAll('[data-asset-restore]')) bind(button, 'click', event => { event.preventDefault(); const id = button.getAttribute?.('data-asset-restore'); if (id && currentState) void persistSetting('hiddenAssetIds', (currentState.settings.hiddenAssetIds ?? []).filter(item => item !== id)); });
    for (const button of queryAll('[data-portfolio-holding-delete]')) bind(button, 'click', event => { event.preventDefault(); const id = button.getAttribute?.('data-portfolio-holding-delete'); if (id) openHoldingDelete(id); });
    for (const button of queryAll('[data-asset-range]')) bind(button, 'click', event => { event.preventDefault(); const id = button.getAttribute!('data-asset-range')!; const value = button.getAttribute!('data-range') as PortfolioRange; assetRanges.set(id, value); renderPortfolio(currentState!); });
    if (focusedAssetDisclosure) queryAll('[data-asset-disclosure]').find(button => button.getAttribute?.('data-asset-disclosure') === focusedAssetDisclosure)?.focus?.();
    else if (focusedRangeAsset && focusedRange) queryAll('[data-asset-range]').find(button => button.getAttribute?.('data-asset-range') === focusedRangeAsset && button.getAttribute?.('data-range') === focusedRange)?.focus?.();
    else if (focusedAssetToggle) queryAll('[data-asset-toggle]').find(button => button.getAttribute?.('data-asset-toggle') === focusedAssetToggle)?.focus?.();
    else if (focusedAssetAction) (queryAll('[data-asset-hide], [data-portfolio-holding-delete]').find(button => button.getAttribute?.('data-asset-hide') === focusedAssetAction || button.getAttribute?.('data-portfolio-holding-delete') === focusedAssetAction) ?? query('[data-asset-disclosure]') ?? query('[data-add-holding]'))?.focus?.();
  };
  const renderState = (state: PortfolioState): void => {
    clearError();
    currentState = state;
    documentRef.documentElement.dataset.theme = state.settings.theme;
    documentRef.documentElement.lang = state.settings.locale;
    documentRef.documentElement.dataset.state = 'ready';
    setText(count, String(state.positions.length + (state.holdings?.length ?? 0)));
    renderPortfolio(state);
    setSettingControls(state.settings);
    renderWalletList(walletList, state.wallets, 'dashboard');
    renderWalletList(settingsWalletList, state.wallets, 'settings');
    renderHoldingList(state);
    for (const element of queryAll('[data-sync-summary]')) setText(element, syncSummaryText(state));
    applyStaticLocale();
    showStatus('status.ready');
    status?.setAttribute?.('data-state', statusToneForMessage(syncSummary(state)));
  };
  const copyWallet = async (id: string): Promise<void> => {
    const result = await api.copyWalletAddress(id);
    const error = resultFailure(result);
    if (error) { showErrorCode(error.code); showStatus('status.copyUnavailable'); return; }
    showStatus('status.copy');
  };
  const refresh = async (successStatus?: MessageKey): Promise<void> => {
    const control = query('[data-refresh]');
    if (control) { control.disabled = true; control.setAttribute?.('aria-busy', 'true'); }
    showStatus('status.syncing');
    try { if (await applyMutation(api.refresh(), false)) showStatus(successStatus ?? syncSummary(currentState!)); }
    finally { if (control) { control.disabled = false; control.setAttribute?.('aria-busy', 'false'); } }
  };
  const detectionText = (match: AddressMatch): string => `${localized('detection.detected')}: ${match.family.toUpperCase()}${match.network ? ` · ${message(locale(), networkKey(match.network))}` : ''}`;
  const showDetectionState = (text: string, state: 'idle' | 'checking' | 'success' | 'error'): void => {
    setText(query('[data-wallet-detection]'), text);
    const result = query('[data-wallet-detection-result]');
    result?.setAttribute?.('data-state', state);
    result?.setAttribute?.('aria-busy', String(state === 'checking'));
    query('[data-detection-icon-use]')?.setAttribute?.('href', ({ idle: '#icon-scan', checking: '#icon-loader', success: '#icon-check-circle', error: '#icon-alert-circle' } as const)[state]);
  };
  const applyDetection = (result: AddressDetection | { readonly ok: false; readonly code: string; readonly message: string }): void => {
    if (!result.ok) { detected = null; showErrorCode(result.code); showDetectionState(localized('error.invalid'), 'error'); return; }
    detected = result;
    const family = query('[data-wallet-family]');
    if (family) { family.value = result.family; family.disabled = true; family.setAttribute?.('aria-invalid', 'false'); }
    showDetectionState(detectionText(result), 'success');
    clearError();
    const evmOptions = query('[data-evm-options]'); if (evmOptions) evmOptions.hidden = result.family !== 'evm';
    setEvmControls();
  };
  const detectInput = async (): Promise<void> => {
    const address = readValue('[data-wallet-address]').trim();
    const generation = ++detectionGeneration;
    detected = null;
    clearError();
    if (!address) { showDetectionState(localized('detection.prompt'), 'idle'); return; }
    showDetectionState(localized('detection.checking'), 'checking');
    if (address.length > MAX_PUBLIC_INPUT_LENGTH) { showErrorCode('invalid-input'); showDetectionState(localized('error.invalid-input'), 'error'); return; }
    try {
      const result = await api.detectWalletAddress(address);
      if (generation !== detectionGeneration || readValue('[data-wallet-address]').trim() !== address) return;
      applyDetection(result);
    } catch { if (generation === detectionGeneration) { showErrorCode('detect'); showDetectionState(localized('error.detect'), 'error'); } }
  };
  const runDetectionNow = (): void => {
    if (detectionTimer !== null) { clearTimeout(detectionTimer); detectionTimer = null; }
    void detectInput();
  };
  const scheduleDetection = (): void => {
    if (detectionTimer !== null) clearTimeout(detectionTimer);
    detectionTimer = null;
    detectionGeneration += 1;
    detected = null;
    clearError();
    const address = readValue('[data-wallet-address]').trim();
    if (address === '') { showDetectionState(localized('detection.prompt'), 'idle'); return; }
    if (address.length > MAX_PUBLIC_INPUT_LENGTH) { showErrorCode('invalid-input'); showDetectionState(localized('error.invalid-input'), 'error'); return; }
    showDetectionState(localized('detection.checking'), 'checking');
    if (typeof documentRef.querySelectorAll !== 'function') { void detectInput(); return; }
    detectionTimer = setTimeout(() => { detectionTimer = null; void detectInput(); }, 220);
  };
  const selectedChainIds = (): number[] => Array.from(query('[data-evm-chains]')?.querySelectorAll?.('input[data-chain-id]') as Iterable<RendererElement> ?? []).filter(input => input.checked).map(input => Number(input.value)).filter(id => Number.isSafeInteger(id) && id > 0);
  const formOptions = (family: WalletFamily): Record<string, unknown> => {
    if (family === 'evm') return { autoScanCommonChains: query('[data-wallet-all-evm]')?.checked !== false, chainIds: selectedChainIds() };
    if (family === 'solana') return { network: 'mainnet-beta' };
    if (family === 'bitcoin') return { network: detected?.network, addressType: detected?.kind && bitcoinKinds.has(detected.kind) ? detected.kind : 'address' };
    return { network: detected?.network };
  };
  const openWallet = (mode: 'add' | 'edit', wallet?: WalletSource, scope: 'dashboard' | 'settings' = 'dashboard'): void => {
    walletDialogMode = mode;
    editingWalletId = wallet?.id ?? null;
    if (detectionTimer !== null) { clearTimeout(detectionTimer); detectionTimer = null; }
    if (wallet) {
      const kind = wallet.family === 'bitcoin' ? wallet.options.addressType : undefined;
      detected = { ok: true, family: wallet.family, normalized: wallet.address, network: 'network' in wallet.options ? wallet.options.network : undefined, kind };
      focusIntent = { kind: 'wallet', id: wallet.id, action: 'edit', scope };
    } else { detected = null; focusIntent = { kind: 'add' }; }
    clearError();
    const address = query('[data-wallet-address]'); const label = query('[data-wallet-label]'); const family = query('[data-wallet-family]');
    if (address) address.value = wallet?.address ?? '';
    if (label) label.value = wallet?.label ?? '';
    if (family) { family.value = wallet?.family ?? ''; family.disabled = true; }
    const enabled = query('[data-wallet-enabled]'); if (enabled) enabled.checked = wallet?.enabled ?? true;
    const allEvm = query('[data-wallet-all-evm]'); if (allEvm) allEvm.checked = wallet?.family === 'evm' ? wallet.options.autoScanCommonChains : true;
    for (const input of queryAll('[data-chain-id]')) input.checked = wallet?.family === 'evm' && !wallet.options.autoScanCommonChains && wallet.options.chainIds.includes(Number(input.value));
    const modeText = query('[data-wallet-dialog-title]'); setText(modeText, localized(mode === 'edit' ? 'dialog.edit' : 'dialog.add'));
    showDetectionState(wallet ? detectionText(detected!) : localized('detection.prompt'), wallet ? 'success' : 'idle');
    const evmOptions = query('[data-evm-options]'); if (evmOptions) evmOptions.hidden = wallet?.family !== 'evm';
    setEvmControls();
    setDialogOpen(walletDialog, true);
    if (!wallet) address?.focus?.();
  };
  const openEdit = (id: string, scope: 'dashboard' | 'settings' = 'dashboard'): void => { const wallet = currentState?.wallets.find(item => item.id === id); if (wallet) openWallet('edit', wallet, scope); };
  const openDelete = (id: string, scope: 'dashboard' | 'settings' = 'dashboard'): void => {
    const wallet = currentState?.wallets.find(item => item.id === id);
    if (!wallet) return;
    pendingDeleteId = id;
    focusIntent = { kind: 'wallet', id, action: 'delete', scope };
    setText(query('[data-delete-wallet-label]'), wallet.label);
    setDialogOpen(deleteDialog, true);
    query('[data-delete-cancel]')?.focus?.();
  };
  const applyMutation = async (resultPromise: Promise<unknown>, announce = true): Promise<boolean> => {
    try {
      const result = await resultPromise;
      const error = resultFailure(result);
      if (error) { showErrorCode(error.code); showStatus(errorKeys[error.code] ?? 'error.generic'); return false; }
      const state = unwrapState(result);
      if (!state) { showControllerError(); return false; }
      renderState(state);
      if (announce) showSaved();
      return true;
    } catch { showControllerError(); return false; }
  };
  const submitWallet = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!detected || detected.normalized !== readValue('[data-wallet-address]').trim()) { if (detectionTimer !== null) { clearTimeout(detectionTimer); detectionTimer = null; } await detectInput(); if (!detected) return; }
    const family = readValue('[data-wallet-family]') as WalletFamily;
    const label = readValue('[data-wallet-label]').trim();
    const address = readValue('[data-wallet-address]').trim();
    if (!families.includes(family) || !label) { showErrorCode(!label ? 'invalid-label' : 'invalid-input'); return; }
    const allEvm = query('[data-wallet-all-evm]')?.checked !== false;
    if (family === 'evm' && !allEvm && selectedChainIds().length === 0) { showErrorCode('invalid-chain-selection'); return; }
    const enabled = query('[data-wallet-enabled]')?.checked !== false;
    const input = { label, family, address, enabled, options: formOptions(family) };
    const result = walletDialogMode === 'edit' && editingWalletId ? api.updateWallet(editingWalletId, input) : api.addWallet(input);
    if (await applyMutation(result)) { setDialogOpen(walletDialog, false); editingWalletId = null; detected = null; restore(); }
  };
  const submitHolding = async (event: Event): Promise<void> => {
    event.preventDefault();
    const quantity = String(readValue('[data-holding-quantity]')).trim().replace(',', '.');
    if (!selectedInstrument) { showHoldingError('invalid-instrument'); return; }
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(quantity) || /^0(?:\.0{1,2})?$/.test(quantity)) { showHoldingError('invalid-quantity'); return; }
    const result = holdingDialogMode === 'edit' && editingHoldingId ? api.updateHolding(editingHoldingId, { quantity }) : api.addHolding({ instrument: selectedInstrument, quantity });
    if (await applyMutation(result)) { setDialogOpen(holdingDialog, false); editingHoldingId = null; selectedInstrument = null; setText(query('[data-instrument-price-hint]'), ''); holdingRestore(); void refresh('status.pricesUpdated'); }
  };
  const persistSetting = async (key: keyof Omit<Settings, 'schemaVersion'>, value: string | boolean | readonly string[]): Promise<void> => { if (currentState) await applyMutation(api.updateSettings({ [key]: value } as Partial<Omit<Settings, 'schemaVersion'>>)); };
  const persistProviders = async (): Promise<void> => {
    const elements = providerElements().map(provider => ({ id: provider.getAttribute!('data-provider-id')!, enabled: provider.checked === true }));
    const keylessIds = new Set(['yahoo.finance', 'coingecko.keyless']);
    const enabled = elements.filter(provider => provider.enabled && !keylessIds.has(provider.id)).map(provider => provider.id);
    const refs = (currentState?.settings.providerRefs ?? []).filter(reference => !keylessIds.has(reference.providerId));
    const keyless = elements.filter(provider => keylessIds.has(provider.id)).map(provider => ({ providerId: provider.id, keyId: null, enabled: provider.enabled }));
    await applyMutation(api.updateSettings({ enabledProviderIds: enabled, providerRefs: [...refs, ...keyless] }));
  };
  const persistProviderEndpoints = async (): Promise<void> => {
    if (!currentState) return;
    const endpoint = readValue('[data-provider-endpoint="solana.rpc"]').trim();
    const rest = (currentState.settings.providerEndpoints ?? []).filter(item => item.providerId !== 'solana.rpc');
    const providerEndpoints = endpoint === '' ? rest : [...rest, { providerId: 'solana.rpc', endpoint, enabled: true }];
    await applyMutation(api.updateSettings({ providerEndpoints }));
  };
  const persistRpcOverrides = async (): Promise<void> => {
    if (!currentState) return;
    const rpcOverrides = queryAll('[data-rpc-chain-id]').map(input => ({ chainId: Number(input.getAttribute!('data-rpc-chain-id')), rpcUrl: String(input.value).trim() })).filter(item => Number.isSafeInteger(item.chainId) && item.chainId > 0 && item.rpcUrl !== '');
    await applyMutation(api.updateSettings({ rpcOverrides }));
  };
  const saveEtherscanKey = async (): Promise<void> => {
    const input = query('[data-etherscan-key]')!;
    const value = String(input.value);
    if (value === '') { showErrorCode('invalid-input'); return; }
    await applyMutation(api.setEtherscanKey(value));
    input.value = '';
  };
  const deleteEtherscanKey = async (): Promise<boolean> => { const deleted = await applyMutation(api.deleteEtherscanKey()); if (deleted) { const input = query('[data-etherscan-key]'); if (input) input.value = ''; } return deleted; };
  const saveFmpKey = async (): Promise<void> => {
    const input = query('[data-fmp-key]')!;
    const value = String(input.value);
    if (value === '') { showErrorCode('invalid-input'); return; }
    await applyMutation(api.setFmpKey(value));
    input.value = '';
  };
  const deleteFmpKey = async (): Promise<boolean> => { const deleted = await applyMutation(api.deleteFmpKey()); if (deleted) { const input = query('[data-fmp-key]'); if (input) input.value = ''; } return deleted; };
  const openKeyDelete = (provider: 'etherscan' | 'fmp', restoreTarget: RendererElement): void => {
    pendingKeyDelete = provider;
    keyDeleteRestoreTarget = restoreTarget;
    setText(query('[data-key-delete-provider]'), provider === 'etherscan' ? 'Etherscan' : 'FMP');
    setDialogOpen(keyDeleteDialog, true);
    query('[data-key-delete-cancel]')?.focus?.();
  };
  const closeKeyDelete = (): void => {
    pendingKeyDelete = null;
    setDialogOpen(keyDeleteDialog, false);
    const target = keyDeleteRestoreTarget;
    keyDeleteRestoreTarget = null;
    target?.focus?.();
  };
  const confirmKeyDelete = async (): Promise<void> => {
    if (!pendingKeyDelete) return;
    const deleted = pendingKeyDelete === 'etherscan' ? await deleteEtherscanKey() : await deleteFmpKey();
    if (deleted) closeKeyDelete();
  };
  const confirmDelete = async (): Promise<void> => { if (!pendingDeleteId) return; const id = pendingDeleteId; if (await applyMutation(api.deleteWallet(id))) { pendingDeleteId = null; setDialogOpen(deleteDialog, false); restore(); } };
  const confirmHoldingDelete = async (): Promise<void> => { if (!pendingHoldingDeleteId) return; const id = pendingHoldingDeleteId; if (await applyMutation(api.deleteHolding(id))) { pendingHoldingDeleteId = null; setDialogOpen(holdingDeleteDialog, false); holdingRestore(); } };
  const bind = (element: RendererElement | null, type: string, callback: (event: Event) => void): void => { element?.addEventListener?.(type, callback); };
  const bindMany = (selectors: readonly string[], type: string, callback: (event: Event) => void): void => { for (const selector of selectors) for (const element of queryAll(selector)) bind(element, type, callback); };
  const bindEvents = (): void => {
    if (eventsBound) return;
    eventsBound = true;
    bind(query('[data-add-wallet]'), 'click', event => { event.preventDefault(); openWallet('add'); });
    bind(query('[data-add-holding]'), 'click', event => { event.preventDefault(); openHolding('add'); });
    bind(query('[data-open-settings]'), 'click', event => { event.preventDefault(); focusIntent = { kind: 'settings' }; setDialogOpen(settingsDialog, true); query('[data-setting-currency]')?.focus?.(); });
    bindMany(['[data-refresh]'], 'click', event => { event.preventDefault(); void refresh(); });
    bindMany(['[data-currency-switch]'], 'click', event => { event.preventDefault(); const value = (event.currentTarget as unknown as RendererElement).getAttribute?.('data-currency-switch'); if (value === 'EUR' || value === 'USD') void persistSetting('currency', value); });
    bindMany(['[data-portfolio-range]'], 'click', event => { event.preventDefault(); const value = (event.currentTarget as unknown as RendererElement).getAttribute?.('data-portfolio-range'); if (value === '1D' || value === '7D' || value === '1M' || value === '1Y' || value === 'MAX') { portfolioRange = value; if (currentState) renderPortfolio(currentState); } });
    bindMany(['[data-portfolio-sort]'], 'click', event => { event.preventDefault(); const value = (event.currentTarget as unknown as RendererElement).getAttribute?.('data-portfolio-sort'); if (value === 'size' || value === 'gainers' || value === 'losers') { portfolioSort = value; if (currentState) renderPortfolio(currentState); } });
    bind(walletForm, 'submit', event => { void submitWallet(event); });
    bind(query('[data-holding-form]'), 'submit', event => { void submitHolding(event); });
    bind(query('[data-wallet-address]'), 'input', scheduleDetection);
    bind(query('[data-wallet-detect]'), 'click', event => { event.preventDefault(); runDetectionNow(); });
    bind(query('[data-instrument-search]'), 'input', scheduleInstrumentSearch);
    bind(query('[data-instrument-search]'), 'keydown', instrumentKeydown);
    bindMany(['[data-holding-cancel]', '[data-holding-cancel-close]'], 'click', event => { event.preventDefault(); searchAbort.abort(); if (searchTimer !== null) clearTimeout(searchTimer); hideSuggestions(); setDialogOpen(holdingDialog, false); editingHoldingId = null; selectedInstrument = null; setText(query('[data-instrument-price-hint]'), ''); holdingRestore(); });
    bind(query('[data-holding-delete-cancel]'), 'click', event => { event.preventDefault(); pendingHoldingDeleteId = null; setDialogOpen(holdingDeleteDialog, false); holdingRestore(); });
    bind(query('[data-holding-delete-confirm]'), 'click', event => { event.preventDefault(); void confirmHoldingDelete(); });
    bindMany(['[data-wallet-cancel]', '[data-wallet-cancel-close]'], 'click', event => { event.preventDefault(); if (detectionTimer !== null) { clearTimeout(detectionTimer); detectionTimer = null; } setDialogOpen(walletDialog, false); editingWalletId = null; detected = null; restore(); });
    bind(query('[data-delete-cancel]'), 'click', event => { event.preventDefault(); pendingDeleteId = null; setDialogOpen(deleteDialog, false); restore(); });
    bind(query('[data-delete-confirm]'), 'click', event => { event.preventDefault(); void confirmDelete(); });
    bindMany(['[data-settings-close]', '[data-settings-close-icon]'], 'click', event => { event.preventDefault(); setDialogOpen(settingsDialog, false); restore(); });
    bind(query('[data-wallet-all-evm]'), 'change', setEvmControls);
    bind(query('[data-setting-currency]'), 'change', event => { void persistSetting('currency', (event.currentTarget as unknown as RendererElement).value ?? 'EUR'); });
    bind(query('[data-setting-locale]'), 'change', event => { void persistSetting('locale', (event.currentTarget as unknown as RendererElement).value ?? 'de'); });
    bind(query('[data-setting-theme]'), 'change', event => { void persistSetting('theme', (event.currentTarget as unknown as RendererElement).value ?? 'dark'); });
    bind(query('[data-setting-scheduler]'), 'change', event => { void persistSetting('schedulerEnabled', Boolean((event.currentTarget as unknown as RendererElement).checked)); });
    bind(query('[data-setting-spam]'), 'change', event => { void persistSetting('spamFilterEnabled', Boolean((event.currentTarget as unknown as RendererElement).checked)); });
    bind(query('[data-setting-hidden-spam]'), 'change', event => { void persistSetting('showHiddenSpamAssets', Boolean((event.currentTarget as unknown as RendererElement).checked)); });
    for (const provider of providerElements()) bind(provider, 'change', () => { void persistProviders(); });
    bind(query('[data-etherscan-key-save]'), 'click', event => { event.preventDefault(); void saveEtherscanKey(); });
    bind(query('[data-etherscan-key-delete]'), 'click', event => { event.preventDefault(); openKeyDelete('etherscan', event.currentTarget as unknown as RendererElement); });
    bind(query('[data-fmp-key-save]'), 'click', event => { event.preventDefault(); void saveFmpKey(); });
    bind(query('[data-fmp-key-delete]'), 'click', event => { event.preventDefault(); openKeyDelete('fmp', event.currentTarget as unknown as RendererElement); });
    bind(query('[data-key-delete-cancel]'), 'click', event => { event.preventDefault(); closeKeyDelete(); });
    bind(query('[data-key-delete-confirm]'), 'click', event => { event.preventDefault(); void confirmKeyDelete(); });
    bind(query('[data-provider-endpoint="solana.rpc"]'), 'change', () => { void persistProviderEndpoints(); });
    for (const input of queryAll('[data-rpc-chain-id]')) bind(input, 'change', () => { void persistRpcOverrides(); });
    documentRef.addEventListener?.('keydown', event => { if ((event as KeyboardEvent).key !== 'Escape') return; if (keyDeleteDialog && !keyDeleteDialog.hidden) { closeKeyDelete(); } else if (holdingDialog && !holdingDialog.hidden) { searchAbort.abort(); hideSuggestions(); setDialogOpen(holdingDialog, false); editingHoldingId = null; selectedInstrument = null; setText(query('[data-instrument-price-hint]'), ''); holdingRestore(); } else if (holdingDeleteDialog && !holdingDeleteDialog.hidden) { pendingHoldingDeleteId = null; setDialogOpen(holdingDeleteDialog, false); holdingRestore(); } else if (walletDialog && !walletDialog.hidden) { if (detectionTimer !== null) { clearTimeout(detectionTimer); detectionTimer = null; } setDialogOpen(walletDialog, false); editingWalletId = null; detected = null; restore(); } else if (deleteDialog && !deleteDialog.hidden) { pendingDeleteId = null; setDialogOpen(deleteDialog, false); restore(); } else if (settingsDialog && !settingsDialog.hidden) { setDialogOpen(settingsDialog, false); restore(); } });
  };
  const render = async (): Promise<void> => { try { const state = unwrapState(await api.getState()); if (!state) { showControllerError(); return; } renderState(state); } catch { showControllerError(); } };
  const start = (): (() => void) => { bindEvents(); if (!minuteDispose) minuteDispose = api.onMinute(() => { void render(); }); void render(); return () => { const dispose = minuteDispose; minuteDispose = null; dispose!(); searchAbort.abort(); if (searchTimer !== null) clearTimeout(searchTimer); if (detectionTimer !== null) clearTimeout(detectionTimer); detectionTimer = null; if (resizeTimer !== null) clearTimeout(resizeTimer); resizeTimer = null; resizeObserver?.disconnect(); resizeObserver = null; chartDisposers.splice(0).forEach(item => item()); }; };
  return { render, start };
}
