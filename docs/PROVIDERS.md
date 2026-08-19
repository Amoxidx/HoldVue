# Provider and chain references

HoldVue does not ship provider credentials or silently select a live service.
The chain registry is metadata only; users must explicitly configure an HTTPS
RPC endpoint for direct EVM RPC scanning, or configure the documented
Etherscan fallback. Provider API keys, if needed for a capability or service
limit, are referenced by an internally generated `ref_...`
`keyId` bound to its `providerId` and belong in encrypted safeStorage—not in
the portfolio JSON state. Raw keys in query strings or path segments are
rejected.

## Configuring a built-in RPC locally

Built-in chain metadata intentionally has `rpcUrl: null`. A user configures an
endpoint by saving a credential-free HTTPS override, for example:

```ts
const next = updateSettings(state, {
  rpcOverrides: [{ chainId: 1, rpcUrl: 'https://your-rpc.example' }],
  enabledChainIds: [1],
  enabledProviderIds: ['evm']
});
const chains = resolveChains(next.settings);
```

`resolveChains` keeps the built-in Ethereum metadata intact and supplies the
override only to the scanner. Development-only `http://localhost` endpoints
are accepted through the explicit development resolver option. Provider keys
are never embedded in these URLs.

Custom chains persist a `nativeDecimals` value between 0 and 36. Existing
custom-chain records that omit this field migrate deterministically to 18;
invalid values are discarded. Native-balance quantities are formatted with
the selected chain's value rather than assuming every native asset has 18
decimals.

Before reading a balance, the scanner compares `eth_chainId` with the selected
chain. A mismatch produces a per-chain `error` result with
`errorCode: 'chain-mismatch'`; no balance is accepted or persisted. A missing
override produces `status: 'unconfigured'`. The main composition also accepts
`bitcoin.mempool`, `solana.rpc`, `cardano.koios`, and `evm.erc20` in
`enabledProviderIds`; Solana/Cardano endpoint overrides are stored in
`providerEndpoints`. EVM native/token requests use the fixed official
Etherscan V2 endpoint when configured, while EVM RPC overrides are configured
per chain. No provider is enabled in the default state.

The default state intentionally keeps `enabledProviderIds` empty so opening a
fresh install makes no network request. Adding a wallet is explicit onboarding
and automatically enables only that wallet family's provider. Bitcoin,
Solana, and Cardano can then use their credential-free official defaults. EVM
uses an RPC override when one is configured; otherwise a configured free
Etherscan key enables its native `balance` and bounded token fallback, subject
to chain/tier limits. The provider toggle remains available for pausing or
re-enabling that family.

For the Etherscan adapter, the settings surface accepts an optional free key in a
password field. Main IPC encrypts it with Electron `safeStorage` into a
separate restrictive ciphertext file and stores only an internally generated
`ref_evm.erc20_...` reference bound to that provider. The secret value never
appears in settings, URLs, renderer data, responses, or logs. The endpoint is
the fixed Etherscan V2 path `https://api.etherscan.io/v2/api`. When an RPC
override is absent, native balances use `module=account&action=balance`.
Current-holdings responses use `TokenAddress`, `TokenSymbol`, `TokenQuantity`,
and `TokenDivisor`. If that path reports a PRO/tier restriction, the free
fallback uses bounded `module=account&action=tokentx` pages (max 1,000 rows per
page) to discover unique non-NFT contracts, then exact
`module=account&action=tokenbalance` calls for each contract. The fallback is
bounded by pages and contracts, validates symbols/decimals/quantities, omits
zero balances and NFT-shaped transfer rows, and marks caps, malformed data,
unsupported chains, 429s, and provider limits as partial/unconfigured rather
than claiming complete coverage. An injected limiter enforces the documented
three calls per second and 100,000 calls per day limits and supports abortable
clock/wait tests.

The scheduler-facing scan coordinator limits active chain RPC operations
globally. Identical concurrent requests share a result only when their
effective chain IDs, credential-free resolved RPC URLs, native decimals, and
wallet options match. A request aborted while waiting for a slot returns a
per-chain `errorCode: 'aborted'` result without starting RPC work.

## Capability matrix

| Capability | Status | Boundary |
| --- | --- | --- |
| EVM native balance | implemented/configured through RPC or Etherscan V2 `balance` fallback | free encrypted key is needed only when no RPC override exists; chain IDs/statuses stay explicit |
| EVM known-token discovery | implemented/configured through Etherscan V2 current-holdings or bounded free fallback | `tokentx` discovery + `tokenbalance`; provider tier/PRO/rate limits/caps are explicit; no completeness claim |
| Bitcoin address balance | implemented/configured through mempool.space | confirmed and mempool deltas are exact; xpub/ypub/zpub/tpub/upub/vpub unsupported |
| Solana native + fungible token accounts | implemented/configured through JSON-RPC | SPL and Token-2022 are read with raw amounts; NFT-like/uncertain rows are filtered |
| Cardano native + fungible assets | implemented/configured through Koios | strict response/fungibility checks; Blockfrost is not required |
| Crypto market prices | implemented/configured through CoinGecko keyless routes | supported mainnet native/known contracts only; testnet/devnet/unsupported platforms remain unpriced; no provider key or AI/LLM-token dependency |
| Stock/ETF market prices | implemented/configured through FMP batch quote + official FX quote | optional encrypted provider key and tier required; missing FX/quotes remain partial; no price inference |
| Instrument search | implemented keylessly for the bundled local catalog; optionally expanded with FMP | local entries resolve to immutable canonical metadata; FMP uses official `search-symbol` + `search-name` and profile-verifies every FMP add |
| NFTs | not supported | no state or scanner type |

The application shell exposes narrow Etherscan and FMP password fields only for
the encrypted key lifecycles described above; it never displays or returns raw
values after submission. FMP search uses the official stable
[`search-symbol`](https://site.financialmodelingprep.com/developer/docs/stable/search-symbol)
and [`search-name`](https://site.financialmodelingprep.com/developer/docs/stable/search-name)
routes with an `apikey` header. Search rows may omit type; the selected row is
not persisted until the official [Company Profile
classification](https://site.financialmodelingprep.com/developer/docs/changelog)
returns complete matching symbol/exchange metadata, `isActivelyTrading: true`,
and either `isEtf: true` or `isEtf: false` with `isFund: false`. Before that
optional provider runs, HoldVue searches a bounded checked-in catalog locally;
its entries are immutable, contain no user data, and resolve only by their exact
catalog identity. Unauthorized, rate-limited, malformed, or unclassified FMP
responses are structured failures and do not remove valid local suggestions.
The provider does not supply prices in this milestone and no price is inferred.
It starts a coordinator only with injected composition,
and the default settings have no enabled provider/endpoints, so a fresh install
performs no live request. A configured sync performs one startup scan, manual
refreshes, and one minute refresh while the app remains open. Provider failures
preserve the last successful positions and expose a stable status instead of
writing zeroes.

The injected transport enforces response-size limits during reader/async-
iterator streaming. A legacy response that exposes only `text()` can be
bounded only after that method has buffered the response; this is a known
adapter boundary, not a claim of hard streaming protection.

## Primary technical references

The implementation follows the primary protocol/provider documentation below:

- [Ethereum JSON-RPC, `eth_getBalance`, quantities and data encoding](https://ethereum.org/en/developers/docs/apis/json-rpc/)
- [Base JSON-RPC chain IDs](https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_chainId)
- [Etherscan API V2 chain-id model](https://docs.etherscan.io/introduction)
- [Etherscan V2 `balance`](https://docs.etherscan.io/api-reference/endpoint/balance)
- [Etherscan V2 `tokenbalance`](https://docs.etherscan.io/api-reference/endpoint/tokenbalance)
- [Etherscan V2 `tokentx`](https://docs.etherscan.io/api-reference/endpoint/tokentx)
- [Etherscan V2 `addresstokenbalance` current holdings](https://docs.etherscan.io/api-reference/endpoint/addresstokenbalance)
- [Etherscan rate limits](https://docs.etherscan.io/resources/rate-limits)
- [Etherscan common errors](https://docs.etherscan.io/resources/common-error-messages)
- [ERC-55 mixed-case EVM checksums](https://eips.ethereum.org/EIPS/eip-55)
- [Bitcoin BIP-32 extended public keys](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki)
- [Bitcoin BIP-173 Bech32](https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki)
- [Bitcoin BIP-350 Bech32m](https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki)
- [Solana JSON-RPC `getBalance`](https://solana.com/docs/rpc/http/getBalance)
- [Solana JSON-RPC `getTokenAccountsByOwner`](https://solana.com/docs/rpc/http/gettokenaccountsbyowner)
- [Solana Token-2022 program](https://www.solana-program.com/docs/token-2022)
- [mempool.space address API](https://mempool.space/docs/api/rest)
- [Koios REST API](https://api.koios.rest/)
- [Cardano CIP-0005 common Bech32 prefixes](https://cips.cardano.org/cip/CIP-0005)
- [Cardano CIP-19 address encoding](https://cips.cardano.org/cip/CIP-19)
- [CoinGecko keyless public API](https://docs.coingecko.com/docs/keyless-public-api)
- [CoinGecko simple price](https://docs.coingecko.com/reference/simple-price)
- [CoinGecko token price by contract](https://docs.coingecko.com/reference/simple-token-price)
- [FMP stable batch quote](https://site.financialmodelingprep.com/developer/docs/stable/batch-quote)
- [FMP stable quote (FX symbols)](https://site.financialmodelingprep.com/developer/docs/stable/quote)

The built-in EVM registry uses the canonical chain IDs and official explorer
destinations for Ethereum, Base, Arbitrum One, Optimism, Polygon PoS, BNB
Smart Chain, Avalanche C-Chain, Gnosis, Linea, Scroll, zkSync Era, Celo, and
Mantle. Explorer URLs are metadata links only; they are never used as an RPC
transport and never contain credentials. Base specifically uses BaseScan's
official Etherscan-family destination rather than Blockscout.

Any future provider adapter must document its official endpoint, authentication
reference, rate limits, response limits, retention, and failure semantics before
being marked `implemented`.

## Price and history boundary

Price quotes and monetary values are persisted as bounded integer strings at
`10^12` scale. Provider JSON numbers are converted to decimal text first;
exponential strings, negative/zero prices, non-finite values, and overflow are
rejected. Excess fractional digits use deterministic half-up rounding. Quantity
math and valuation use BigInt, never binary floating-point holdings.

CoinGecko requests `vs_currencies=eur,usd`, `include_24hr_change=true`, and
`include_last_updated_at=true`. Native CoinGecko IDs can be shared by multiple
chain-qualified assets without merging those assets; each receives the same
validated quote. Contract requests are grouped by asset platform and bounded
in batches. A 429 or suitable 5xx gets one bounded retry and then a structured
provider status/cooldown; aborts stop the request or backoff. No API key is
sent.

FMP requests batch quotes for the selected manual instruments and loads
`EURUSD` plus each distinct non-EUR/non-USD currency as one FX quote per
refresh. Symbol matching, positive prices, timestamps, and previous-close
fields are strict. Missing daily fields yield a quote without a fabricated
zero-percent change; missing FX leaves that instrument partial/unpriced.

The refresh pipeline preserves last-good quotes and marks their status stale
when a provider fails. New history points are written only for successful,
defined values. Asset price series and portfolio-value series are compacted
locally in deterministic age tiers, and partial portfolio points carry a
partial coverage marker. History begins at the first successful refresh after
installation and is not downloaded from a remote service. The current UI
displays the selected currency's exact total and per-holding price/value with
coverage (`valued/total`) and an explicit unavailable state; it does not claim
that a partial sum is complete. Portfolio-value and per-asset price charts are
local-history views with 1D/7D/1M/1Y/MAX ranges, sparse axes, exact hover
values, pointer/crosshair support, and keyboard access.
