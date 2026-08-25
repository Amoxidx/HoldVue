# HoldVue architecture

HoldVue is local-first. The renderer has no filesystem or network authority;
main-process composition owns local state, and all provider access is injected
behind explicit ports.

## Domain state

`src/shared/state.ts` is the only persisted model. It is schema version 5 and
contains typed `WalletSource` unions, typed fungible/native `Position` values,
exact base-unit strings, sync status, settings, custom-chain definitions,
provider references, canonical `Instrument` metadata, and exact manual
`Holding` quantities in hundredths. Canonical manual instruments may originate
from the immutable bundled catalog or an explicitly configured provider. There
is no NFT variant and no secret field.
`parsePortfolioState` migrates version 1/2/3/4 or an empty/malformed file
deterministically to a sanitized version-5 state. Invalid
wallets and untyped legacy positions are discarded rather than guessed.

Wallet CRUD receives an injected ID factory and clock. It normalizes and
validates the selected family, rejects duplicates and recursively rejects
secret-shaped input (including nested options/arrays), and returns structured
error codes instead of throwing for user input errors. Positions are retained
only when they reference an existing wallet of the same family; EVM positions
require a positive chain ID and non-EVM positions require `chainId: null`.

## Address and chain boundaries

`src/shared/addresses.ts` performs offline validation: EVM addresses use exact
20-byte hex and ERC-55 mixed-case checksums; Bitcoin validates Base58Check,
Bech32/Bech32m witness addresses, and public extended-key version bytes;
Solana decodes Base58 to exactly 32 bytes; Cardano validates Bech32 checksums,
CIP-19 Shelley address types/payload lengths/network tags, and the CIP-5
address/stake prefixes. Byron addresses are outside scope and rejected.
Explicit Bitcoin/Cardano network options must match the address; when omitted,
the detected network is persisted. Auto-detection returns one family or a
structured invalid/ambiguous result.

`src/shared/chains.ts` keeps built-in EVM metadata immutable. Custom chains are
validated independently, require positive unique IDs, native decimals from 0
through 36 (existing chains migrate deterministically to 18), and HTTPS URLs, and may
use HTTP only for localhost during explicit development configuration. URL
userinfo, credential-like query parameters, and API-key-looking path segments
are rejected. Built-in metadata remains immutable: `settings.rpcOverrides`
resolves credential-free HTTPS RPC endpoints onto built-in chain IDs without
overwriting chain metadata. `resolveChains(settings)` combines built-ins and
validated custom chains and applies enabled-chain filtering.

## Provider and scanner boundaries

`src/shared/transport.ts` is an injected HTTP/JSON port with AbortSignal,
timeouts, positive safe response-size limits, and redacted error codes. When a
Fetch body exposes a reader or async iterator, UTF-8 response limits are
enforced while chunks are received; a legacy response exposing only `text()`
can enforce the limit only after that API has buffered the body. This fallback
is intentionally documented and does not claim a streaming hard-limit.
Fixed adapters use official HTTPS endpoint templates; endpoint validation
rejects credentials, local/private targets, and credential-looking paths. It
never runs unless a caller supplies an adapter and explicitly invokes it.

`src/shared/scanner.ts` implements JSON-RPC envelope validation and EVM native
balance reads through credential-free built-in public RPCs or user overrides. Hex quantities are parsed as `bigint`
and formatted exactly using the selected chain's persisted `nativeDecimals`
(built-ins default explicitly to 18). Missing RPCs report
`unconfigured`; malformed responses and provider failures stay per-chain. Each
scan first calls `eth_chainId`; a provider mismatch is reported as
`chain-mismatch` and its balance is discarded. Disabled wallets and disabled
chain IDs are skipped. `createScanCoordinator` combines single-flight by a
hash of the effective wallet/options/chain configuration with a real global
concurrency limit at each chain RPC operation, including scans spanning
multiple wallets and chains. A queued, aborted operation is discarded before
it can call the injected RPC port.
`src/shared/adapters.ts` contains explicit, injected adapters. The EVM adapter
uses native RPC scans without a key. Listed-token discovery uses CoinGecko's
contract catalog and verifies balances and decimals directly on-chain. Optional
indexer expansion uses the official Etherscan
V2 current-holdings path when an encrypted free-key reference exists and falls back from a PRO/tier
response to bounded `tokentx` contract discovery followed by `tokenbalance`.
The injected limiter enforces three calls per second and 100,000 calls per day;
pages, contracts, malformed metadata, NFT-shaped transfers, unsupported chains,
and provider failures remain partial/unconfigured rather than becoming zero.
Bitcoin scans validated addresses through the official mempool.space REST shape (xpubs remain unsupported). Solana reads
`getBalance` and both SPL programs using raw integer token amounts. Cardano
uses strict Koios `address_info`/`address_assets` responses. Every adapter
excludes NFTs and uncertain fungibility rather than guessing. Unsupported or
unconfigured capabilities remain structured results.

`src/shared/pricing.ts` is the price/valuation boundary. It derives canonical
asset identities from family plus chain/network plus asset kind, so equal
symbols or contract strings cannot collide across chains or environments.
CoinGecko's keyless simple-price and token-price routes cover supported mainnet
crypto assets; one CoinGecko ID may populate several chain-qualified native
asset IDs, while testnet/devnet and unsupported platforms remain unpriced. The
keyless Yahoo Finance adapter is the primary stock/ETF source and validates
chart metadata, current/previous closes, currencies, timestamps, and required
FX crosses. The FMP batch-quote adapter is an optional fallback for unresolved
manual instruments and loads distinct currency conversions once per refresh.
It sends provider credentials only through the injected secret getter and
request headers. Both adapters parse bounded decimal inputs into `10^12`
fixed-point strings, derive daily changes with BigInt arithmetic, and return
structured partial/rate-limited/unconfigured statuses without converting an
error into zero.

`valueAssets` aggregates quantities by canonical asset identity and emits
per-asset valuations plus `complete`, `valuedAssets`, and `totalAssets`. A
portfolio total is complete only when every active asset has a valid quote and
daily change data is complete only when every valued asset has a valid previous
price. `updateHistory` records only successful prices and defined totals. It
deduplicates timestamps and compacts local points into fine recent, 30-minute,
4-hour, and daily tiers with a deterministic hard cap while preserving the
earliest and latest range. Partial portfolio points retain their coverage
marker; no artificial zero point is written. The coordinator keeps all active
asset valuations and price histories for restore, while its inclusion set excludes
user-hidden and high-confidence-spam assets from the portfolio total and
`portfolio-value` history. Showing quarantined assets changes visibility only;
disabling the spam filter explicitly includes them again.

`src/shared/sync.ts` performs one global concurrency-limited scan operation per
wallet, reconciles successful/partial data atomically, preserves old positions
on provider failure, and records last-attempt/last-success status. Results and
reconciliation are applied in wallet order even when requests complete out of
order. Single-flight keys include effective state configuration, while the
underlying EVM scanner additionally includes RPC-port and AbortSignal identity.

## Asset safety and secrets

`src/shared/spam.ts` emits deterministic risk flags and reasons for fungible
token metadata. Native assets bypass every spam rule. Only high-confidence spam
classifications are hidden by default; metadata-missing or unverified signals
alone remain visible. Hidden assets remain recoverable through settings.

`src/shared/secrets.ts` requires an Electron `safeStorage`-compatible adapter
and an encrypted blob store. If encryption is unavailable or fails, operations
fail closed. Plaintext values are never written to JSON state, renderer data,
logs, or a fallback file.

## Runtime flow

The minute scheduler emits only a local signal. Main composition wires that
signal to an injected scan coordinator; a configured refresh runs wallet scan,
price fetch, exact valuation, history update, and one atomic state save before
emitting one renderer event. An empty default portfolio performs no live
network call; a user-created wallet or manual holding explicitly supplies the
asset scope for enabled providers. Main IPC
exposes narrowly scoped, typed channels for state, offline address detection,
wallet add/edit/delete, settings updates, and the minute signal. Every state
mutation is serialized in one main-process queue; IDs and timestamps are
generated in main from injected production dependencies, never selected by
the renderer. Preload forwards only those APIs through context isolation.

The renderer is a dependency-injected controller over semantic HTML dialogs
and forms. It renders wallet management and settings immediately from local
state, displays validation/provider/sync failures as a local status, disposes
the minute listener, and does not expose filesystem, network, signing, or
provider key authority. It displays reconciled positions/statuses, the selected
currency's exact portfolio total and coverage, per-holding price/value, and
explicit unpriced or stale states. It renders responsive interactive SVG
portfolio-value and per-asset price charts from local history with sparse,
localized axes, range controls, pointer/keyboard tooltips, and honest
empty/partial states.

The empty default keeps all providers disabled. A user Add-wallet action is
explicit onboarding: main enables only the corresponding family provider in
the persisted settings. Bitcoin, Solana, and Cardano can then use their fixed
credential-free defaults; EVM uses credential-free built-in public RPCs or a
chain override for native balances. Keyless catalog discovery adds bounded,
on-chain-verified ERC-20 coverage; an encrypted Etherscan key can expand it on
chains included in the configured tier. Chain/tier limits remain explicit.

## Release packaging

`assets/branding/holdvue-icon-master.png` is the traceable branding source.
`scripts/create-icons.mjs` deterministically derives checked-in PNG sizes,
`holdvue.icns`, and `holdvue.ico`; the renderer receives a copied PNG favicon
and header mark. `electron-builder` produces unsigned macOS DMG/ZIP and
Windows NSIS/ZIP packages through `npm run package:mac` and
`npm run package:win`. Packaging runs the full offline gate first, writes only
to the ignored `release/` directory, and never signs, notarizes, publishes, or
reads credentials. CI uses read-only repository permissions and uploads only
unsigned build artifacts.
