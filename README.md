# HoldVue

HoldVue is a local-first Electron + TypeScript foundation for observing a
portfolio on macOS and Windows. The app starts with an empty, schema-versioned
portfolio and stores state locally. Wallet sources are public addresses or
public extended keys only; private keys, seed phrases, and signing material
are never accepted.

Keine Anlageberatung. HoldVue is not investment advice. Wallet addresses are public on blockchains,
but local configuration and any imported data remain the user's
responsibility. HoldVue does not support NFTs and has no AI/LLM-token
dependency at runtime. Provider API keys are a separate, optional capability
requirement: some providers work keylessly, while Etherscan/FMP features may
require a free or tier-appropriate key. Only encrypted safeStorage references
are allowed, never key values in the portfolio state.

The current capability boundary is intentionally explicit:

- implemented: typed wallet CRUD, schema-v5 migration, offline address checksums, common-EVM metadata, injected transport, exact integer-unit reconciliation, fixed-point valuation/history, and fail-closed secret storage;
- live adapters, configured explicitly: EVM native balances through credential-free built-in public RPCs (replaceable by local overrides); Bitcoin address balances through mempool.space; Solana native/SPL and Token-2022 fungible balances; and Cardano native/fungible Koios balances;
- limited by provider capability: EVM native balances work without a key. ERC-20 discovery uses the official Etherscan V2 current-holdings path when a free encrypted key is supplied, then falls back to bounded `tokentx` discovery plus `tokenbalance` where required. Rate limits, 3-calls/second and 100k/day caps, PRO restrictions, malformed data, and unsupported chains remain visible partial/unconfigured statuses and never become zero balances;
- implemented/configured without a crypto key: CoinGecko keyless EUR/USD quotes for supported mainnet native assets and known fungible contracts. Testnet/devnet assets and unsupported platforms stay explicitly unpriced. Quotes, values, daily changes, and local history use exact scaled integer strings; provider failures preserve last-good data and never become zero;
- implemented without a key for stocks/ETFs: Yahoo Finance search and chart data provide automatic instrument discovery and current quotes. Returned symbols, types, currencies, timestamps, previous closes, and FX crosses are validated strictly; missing, malformed, mismatched, or rate-limited responses remain visibly unpriced/partial and never become zero;
- implemented with the optional encrypted FMP key as a fallback: batch stock/ETF quotes and official FX conversion can fill instruments Yahoo did not price. Missing key, tier limits, missing FX, malformed rows, and rate limits remain partial/unpriced; no one-to-one currency assumption or price inference is made;
- implemented locally for common instruments: a bundled, read-only catalog provides deterministic suggestions such as MSCI World ETFs and widely held US/European equities before the keyless Yahoo search. FMP can optionally expand the provider set; every remote selection is resolved to canonical metadata before persistence. Search never invents a price;
- manual holdings: exact positive quantities for verified stocks and ETFs, with local edit/delete and no inferred valuation;
- unsupported: Bitcoin extended-key scanning, uncertain Solana/Cardano NFT-like assets, and all NFTs. Portfolio and per-asset price charts are local-history views; they do not infer prices or add unsupported assets.

Wallet onboarding and management are implemented locally: enter a public
address or public extended key, inspect the offline family/network detection,
then add, edit, copy, or delete the wallet. The settings surface persists
EUR/USD, DE/EN, light/dark, scheduler, spam-filter, and hidden-spam choices.
The settings surface can store optional Etherscan and FMP keys through encrypted
password fields; the renderer receives only configured/not-configured state and
the portfolio stores only an internally generated safeStorage reference. The
default portfolio remains empty and has no enabled providers. Adding a wallet
is the explicit onboarding action: it enables that family's provider
(`bitcoin.mempool`, `solana.rpc`, `cardano.koios`, or `evm`) so the next manual
or scheduled refresh can track it. EVM native balances use credential-free
built-in public RPCs or a user override; a configured free Etherscan key adds
the documented ERC-20 discovery path. Chain and provider tier limits remain
visible as partial/unconfigured status, and no incomplete result is reported
as complete. Deleting a wallet also removes its associated local positions
through the domain integrity rules.

No network request is made before the user explicitly adds a wallet or manual
holding, and all unit tests use injected local fakes. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/PROVIDERS.md](docs/PROVIDERS.md) for the boundaries and official
references.

The price/history domain is schema v5. Prices and monetary values are stored as
bounded integers at `10^12` scale with deterministic half-up rounding; quantities
remain integer base units/hundredths. History is local-only and starts at the
first successful valuation after installation. The shell shows the selected
EUR/USD total, valued-asset coverage, per-holding price/value, and explicit
stale/partial/unpriced states; it does not present an incomplete sum as complete.
Portfolio history and the displayed total use the same inclusion set: user-hidden
assets and high-confidence spam quarantine remain available for restore, quotes,
and per-asset history, but are excluded from the total until restored (or until
the spam filter is disabled). `showHiddenSpamAssets` changes visibility only and
does not silently change the total.

## Development

```sh
npm ci
npm test
npm run coverage
npm run typecheck
npm run build
```

Tests are offline and use only empty or clearly synthetic fixtures. The minute
scheduler is local; when adapters are explicitly configured, main performs one
initial sync and one refresh per minute while the app is open. All network
ports, clocks, IDs, and timers are injectable.

Built-in EVM chains include credential-free public RPC defaults. Optional
`rpcOverrides` keyed by chain ID replace those endpoints without overwriting
the remaining built-in metadata. Enable the matching
provider ID in `settings.enabledProviderIds`. The scanner checks
`eth_chainId` before `eth_getBalance` and reports `chain-mismatch` without
accepting a balance when an endpoint serves the wrong network. Provider keys,
if needed by the Etherscan adapter, stay in encrypted safeStorage references.
Custom chains persist validated native decimals (0–36; omitted legacy values
migrate to 18), and the scheduler coordinator caps concurrent chain RPC work
globally with queued aborts failing before any request starts.

The read-only local catalog is searched first and requires no provider key or network request. Yahoo Finance then expands search and provides keyless stock/ETF chart quotes; FMP remains an optional encrypted-key fallback. Invalid, rate-limited, malformed, or unclassified remote responses do not invalidate local matches, create guessed instruments, or fabricate prices.

Unsigned local distribution packages can be built with `npm run package:mac`
(universal macOS), `npm run package:mac:x64`, `npm run package:mac:arm64`, or
`npm run package:win` (Windows x64). They run the complete offline gate first
and use electron-builder with the checked-in HoldVue branding. CI builds
separate macOS x64/arm64 and Windows x64 artifacts with deterministic names.
CI creates unsigned artifacts only; signing, notarization, publishing, and
release credentials are deliberately not configured.

After a local macOS package, audit its contents before moving or sharing the
artifact with `node scripts/audit-package.mjs
release/mac/HoldVue.app/Contents/Resources/app.asar` (or the corresponding
`release/mac-arm64` path for the local ARM build). The audit rejects
tests, source/docs/fixtures, user-state files, personal paths, addresses,
credentials, and private-key patterns. Windows packaging uses the same
allowlist in CI; cross-building Windows on macOS is intentionally left to the
Windows runner. Run the source-tree gate first, then package, then this
artifact audit.

For visual development, `test/fixtures/portfolio-preview.json` is a clearly
synthetic, dev-only manual-ETF state with local price and portfolio history.
Run `npm run preview` from the repository root to open it in a development-only
Electron window; expand the synthetic asset and move over its chart to smoke
test the detail view, tooltip, and keyboard chart access. The preview preload
is a local fake API, never scans a wallet or calls a provider. The fixture and
preview script are excluded from packaged runtime files and are never loaded
as the default portfolio. For a deterministic visual artifact, pass
`HOLDVUE_PREVIEW_SCREENSHOT=/tmp/holdvue-preview.png npm run preview` (or pass
`--screenshot /tmp/holdvue-preview.png` to `electron scripts/preview.mjs`); the
development window waits for rendering, writes the PNG, and exits. If the local
macOS session has no usable WindowServer, the Electron command fails clearly
instead of producing an empty image. The repository's DOM and chart tests cover
the populated synthetic fixture deterministically; manual PNG capture requires
a macOS session with a usable WindowServer.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/PROVIDERS.md](docs/PROVIDERS.md) for the boundaries used by future
integrations. The cross-platform UI, icon and visual-QA contract lives in
[docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md). Security expectations are in
[SECURITY.md](SECURITY.md).
