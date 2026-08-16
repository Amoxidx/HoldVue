import type { Position, Settings, SpamAssessment, SpamRiskFlag } from './state.ts';

export interface FungibleTokenMetadata {
  readonly assetKind: 'native' | 'fungible';
  readonly symbol?: string;
  readonly name?: string;
  readonly url?: string;
  readonly decimals?: number;
  readonly quantity?: string;
  readonly verified?: boolean;
  readonly airdrop?: boolean;
}

export interface SpamRuleResult { readonly flag: SpamRiskFlag; readonly reason: string; }

function hasText(value: string | undefined): boolean { return value !== undefined && value.trim() !== ''; }
function suspiciousName(value: string | undefined): boolean { return value !== undefined && /(?:airdrop|claim|free|bonus|gift|reward)/i.test(value); }
function suspiciousUrl(value: string | undefined): boolean { return value !== undefined && /(?:xn--|bit\.ly|t\.me|discord\.gg|claim)/i.test(value); }
function invalidDecimals(value: number | undefined): boolean { return value !== undefined && (!Number.isInteger(value) || value < 0 || value > 36); }
function implausibleQuantity(value: string | undefined): boolean { return value !== undefined && (!/^\d+(?:\.\d+)?$/.test(value) || value.length > 80); }

export function evaluateSpamRules(metadata: FungibleTokenMetadata): readonly SpamRuleResult[] {
  if (metadata.assetKind === 'native') return [];
  return [
    ...(!hasText(metadata.name) || !hasText(metadata.symbol) ? [{ flag: 'metadata-missing' as const, reason: 'Token name or symbol is missing.' }] : []),
    ...(suspiciousName(metadata.name) ? [{ flag: 'suspicious-name' as const, reason: 'Token name contains a solicitation-like pattern.' }] : []),
    ...(suspiciousUrl(metadata.url) ? [{ flag: 'suspicious-url' as const, reason: 'Token URL contains a high-risk redirect or claim pattern.' }] : []),
    ...(invalidDecimals(metadata.decimals) ? [{ flag: 'invalid-decimals' as const, reason: 'Token decimals are outside the supported range.' }] : []),
    ...(implausibleQuantity(metadata.quantity) ? [{ flag: 'implausible-quantity' as const, reason: 'Token quantity is malformed or implausibly long.' }] : []),
    ...(metadata.verified === false ? [{ flag: 'unverified' as const, reason: 'Token verification was not provided.' }] : []),
    ...(metadata.airdrop === true ? [{ flag: 'airdrop-signal' as const, reason: 'Provider marked the token as an airdrop signal.' }] : [])
  ];
}

export function classifyFungibleToken(metadata: FungibleTokenMetadata): SpamAssessment {
  const rules = evaluateSpamRules(metadata);
  const highConfidence = rules.some(rule => ['suspicious-name', 'suspicious-url', 'invalid-decimals', 'implausible-quantity', 'airdrop-signal'].includes(rule.flag));
  return { riskFlags: rules.map(rule => rule.flag), reasons: rules.map(rule => rule.reason), hiddenByDefault: highConfidence };
}

export function shouldShowPosition(position: Position, settings: Settings): boolean {
  if (position.assetKind === 'native' || !settings.spamFilterEnabled) return true;
  if (!position.spam?.hiddenByDefault) return true;
  return settings.showHiddenSpamAssets;
}
