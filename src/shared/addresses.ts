import { createHash } from 'node:crypto';
import type { BitcoinAddressType, BitcoinNetwork, WalletFamily } from './state.ts';

export type AddressErrorCode = 'invalid' | 'ambiguous';
export interface AddressMatch { readonly ok: true; readonly family: WalletFamily; readonly normalized: string; readonly network?: string; readonly kind?: string; }
export interface AddressFailure { readonly ok: false; readonly code: AddressErrorCode; readonly message: string; readonly candidates?: readonly WalletFamily[]; }
export type AddressDetection = AddressMatch | AddressFailure;
export type AddressValidation = AddressMatch | AddressFailure;

/** Maximum public-address/xpub input accepted before any expensive decoding. */
export const MAX_PUBLIC_INPUT_LENGTH = 256;

const HEX = /^[0-9a-fA-F]+$/;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const MASK_64 = (1n << 64n) - 1n;
const KECCAK_ROUNDS = [
  1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn,
  0x80000001n, 0x8000000080008081n, 0x8000000000008009n, 0x8an, 0x88n,
  0x80008009n, 0x8000000an, 0x8000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x800an,
  0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x80000001n,
  0x8000000080008008n
];
const KECCAK_ROTATIONS = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

function rotate(value: bigint, shift: number): bigint {
  if (shift === 0) return value & MASK_64;
  const amount = BigInt(shift);
  return ((value << amount) | (value >> (64n - amount))) & MASK_64;
}

function keccakPermutation(state: bigint[]): void {
  for (const roundConstant of KECCAK_ROUNDS) {
    const columns = [0n, 0n, 0n, 0n, 0n];
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) columns[x]! ^= state[x + (5 * y)]!;
    const delta = columns.map((_, x) => columns[(x + 4) % 5]! ^ rotate(columns[(x + 1) % 5]!, 1));
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) state[x + (5 * y)]! ^= delta[x]!;
    const rotated = Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) rotated[y + (5 * ((2 * x + 3 * y) % 5))] = rotate(state[x + (5 * y)]!, KECCAK_ROTATIONS[x + (5 * y)]!);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) state[x + (5 * y)] = rotated[x + (5 * y)]! ^ ((~rotated[(x + 1) % 5 + (5 * y)]!) & rotated[(x + 2) % 5 + (5 * y)]!);
    state[0]! ^= roundConstant;
  }
}

function keccak256(input: Uint8Array): Uint8Array {
  const rate = 136;
  const paddedLength = Math.ceil((input.length + 1) / rate) * rate;
  const padded = new Uint8Array(paddedLength);
  padded.set(input); padded[input.length]! = 0x01; padded[padded.length - 1]! |= 0x80;
  const state = Array<bigint>(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let lane = 0; lane < rate / 8; lane++) {
      let value = 0n;
      for (let byte = 0; byte < 8; byte++) value |= BigInt(padded[offset + (lane * 8) + byte]!) << BigInt(byte * 8);
      state[lane]! ^= value;
    }
    keccakPermutation(state);
  }
  const output = new Uint8Array(32);
  for (let byte = 0; byte < output.length; byte++) output[byte]! = Number((state[Math.floor(byte / 8)]! >> BigInt((byte % 8) * 8)) & 0xffn);
  return output;
}

function utf8(value: string): Uint8Array { return new TextEncoder().encode(value); }

function sha256(value: Uint8Array): Uint8Array { return createHash('sha256').update(value).digest(); }
function checksum(value: Uint8Array): Uint8Array { return sha256(sha256(value)).subarray(0, 4); }

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function decodeBase58(value: string): Uint8Array | null {
  if (value === '' || [...value].some(character => BASE58_ALPHABET.indexOf(character) < 0)) return null;
  const bytes: number[] = [];
  for (const character of value) {
    let carry = BASE58_ALPHABET.indexOf(character);
    for (let index = 0; index < bytes.length; index++) { const next = bytes[index]! * 58 + carry; bytes[index]! = next & 0xff; carry = next >> 8; }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const character of value) { if (character !== '1') break; bytes.push(0); }
  return Uint8Array.from(bytes.reverse());
}

function encodeBase58(value: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of value) {
    let carry = byte;
    for (let index = 0; index < digits.length; index++) { const next = digits[index]! * 256 + carry; digits[index]! = next % 58; carry = Math.floor(next / 58); }
    while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  let result = '';
  for (const byte of value) { if (byte !== 0) break; result += '1'; }
  return result + digits.reverse().map(digit => BASE58_ALPHABET[digit]).join('');
}

export function encodeBase58Check(payload: Uint8Array): string { return encodeBase58(concat(payload, checksum(payload))); }

function verifyBase58Check(value: string): Uint8Array | null {
  const decoded = decodeBase58(value);
  if (!decoded || decoded.length < 5) return null;
  const payload = decoded.subarray(0, decoded.length - 4);
  const actual = decoded.subarray(decoded.length - 4);
  const expected = checksum(payload);
  return actual.every((byte, index) => byte === expected[index]) ? payload : null;
}

function bech32Polymod(values: readonly number[]): number {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let value = 1;
  for (const item of values) {
    const top = value >>> 25;
    value = ((value & 0x1ffffff) << 5) ^ item;
    for (let index = 0; index < 5; index++) if ((top >>> index) & 1) value ^= generators[index]!;
  }
  return value >>> 0;
}

function expandHrp(hrp: string): number[] { return [...hrp].map(character => character.charCodeAt(0) >> 5).concat([0], [...hrp].map(character => character.charCodeAt(0) & 31)); }

function decodeBech32(value: string, expectedConstants: readonly number[], maxLength = 90): { hrp: string; data: number[]; constant: number } | null {
  if (value.length < 8 || value.length > maxLength || value !== value.toLowerCase() && value !== value.toUpperCase()) return null;
  const lower = value.toLowerCase();
  const separator = lower.lastIndexOf('1');
  if (separator < 1 || separator + 7 > lower.length) return null;
  const hrp = lower.slice(0, separator);
  const values = [...lower.slice(separator + 1)].map(character => BECH32_CHARSET.indexOf(character));
  if (values.some(valuePart => valuePart < 0)) return null;
  const polymod = bech32Polymod(expandHrp(hrp).concat(values));
  if (!expectedConstants.includes(polymod)) return null;
  return { hrp, data: values.slice(0, -6), constant: polymod };
}

function encodeBech32Words(hrp: string, data: readonly number[], constant: number): string {
  const values = expandHrp(hrp).concat([...data], 0, 0, 0, 0, 0, 0);
  const mod = bech32Polymod(values) ^ constant;
  const checksumValues = Array.from({ length: 6 }, (_, index) => (mod >>> (5 * (5 - index))) & 31);
  return `${hrp}1${[...data, ...checksumValues].map(value => BECH32_CHARSET[value]).join('')}`;
}

export function encodeBech32(hrp: string, bytes: Uint8Array, witnessVersion?: number): string {
  const data = convertBits([...bytes], 8, 5, true)!;
  const words = witnessVersion === undefined ? data : [witnessVersion, ...data];
  return encodeBech32Words(hrp, words, witnessVersion !== undefined && witnessVersion > 0 ? 0x2bc830a3 : 1);
}

export function convertBits(data: readonly number[], fromBits: number, toBits: number, pad: boolean): number[] | null {
  let accumulator = 0;
  let bits = 0;
  const result: number[] = [];
  const maxValue = (1 << toBits) - 1;
  const maxAccumulator = (1 << (fromBits + toBits - 1)) - 1;
  for (const value of data) {
    if (value < 0 || (value >> fromBits) !== 0) return null;
    accumulator = ((accumulator << fromBits) | value) & maxAccumulator;
    bits += fromBits;
    while (bits >= toBits) { bits -= toBits; result.push((accumulator >> bits) & maxValue); }
  }
  if (pad) { if (bits > 0) result.push((accumulator << (toBits - bits)) & maxValue); }
  else if (bits >= fromBits || ((accumulator << (toBits - bits)) & maxValue) !== 0) return null;
  return result;
}

function isEvmMixedCase(address: string): boolean {
  const body = address.slice(2);
  return /[a-f]/.test(body) && /[A-F]/.test(body);
}

function inputTooLong(value: unknown): boolean { return typeof value !== 'string' || value.length > MAX_PUBLIC_INPUT_LENGTH; }

function tooLongFailure(): AddressFailure { return { ok: false, code: 'invalid', message: 'Public address input is too long.' }; }

export function checksumEvmAddress(address: string): string {
  const lower = address.slice(2).toLowerCase();
  const hash = keccak256(utf8(lower));
  let result = '0x';
  for (let index = 0; index < lower.length; index++) {
    const character = lower[index]!;
    const nibble = hash[Math.floor(index / 2)]!;
    result += /[a-f]/.test(character) && ((nibble >>> (index % 2 === 0 ? 4 : 0)) & 15) >= 8 ? character.toUpperCase() : character;
  }
  return result;
}

export function validateEvmAddress(value: string): AddressValidation {
  if (inputTooLong(value)) return tooLongFailure();
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) return { ok: false, code: 'invalid', message: 'EVM address must be exactly 20 bytes of hexadecimal data.' };
  if (isEvmMixedCase(value) && checksumEvmAddress(value) !== value) return { ok: false, code: 'invalid', message: 'Mixed-case EVM address checksum is invalid.' };
  return { ok: true, family: 'evm', normalized: isEvmMixedCase(value) ? value : `0x${value.slice(2).toLowerCase()}` };
}

function bitcoinAddress(value: string, network: BitcoinNetwork): AddressValidation {
  const payload = verifyBase58Check(value);
  if (payload && payload.length === 21) {
    const version = payload[0];
    const expectedVersions = network === 'mainnet' ? [0, 5] : [111, 196];
    if (version !== undefined && expectedVersions.includes(version)) return { ok: true, family: 'bitcoin', normalized: value, network, kind: version === expectedVersions[0]! ? 'p2pkh' : 'p2sh' };
  }
  const decoded = decodeBech32(value, [1, 0x2bc830a3]);
  if (!decoded || (network === 'mainnet' ? decoded.hrp !== 'bc' : decoded.hrp !== 'tb') || decoded.data.length === 0) return { ok: false, code: 'invalid', message: 'Bitcoin address checksum, network, or payload is invalid.' };
  const version = decoded.data[0];
  const program = convertBits(decoded.data.slice(1), 5, 8, false);
  const constant = decoded.constant;
  if (version === undefined || !program || version > 16 || program.length < 2 || program.length > 40 || (version === 0 && constant !== 1) || (version > 0 && constant !== 0x2bc830a3)) return { ok: false, code: 'invalid', message: 'Bitcoin witness address is invalid.' };
  if (version === 0 && program.length !== 20 && program.length !== 32) return { ok: false, code: 'invalid', message: 'Bitcoin v0 witness program has an invalid length.' };
  return { ok: true, family: 'bitcoin', normalized: value, network, kind: version === 1 ? 'p2tr' : 'segwit' };
}

function bitcoinExtendedKey(value: string, network: BitcoinNetwork, expectedType?: BitcoinAddressType): AddressValidation {
  const payload = verifyBase58Check(value);
  if (!payload || payload.length !== 78) return { ok: false, code: 'invalid', message: 'Bitcoin extended public key checksum or length is invalid.' };
  const version = [...payload.slice(0, 4)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const versions: Record<string, { network: BitcoinNetwork; type: BitcoinAddressType }> = {
    '0488b21e': { network: 'mainnet', type: 'xpub' }, '049d7cb2': { network: 'mainnet', type: 'ypub' }, '04b24746': { network: 'mainnet', type: 'zpub' },
    '043587cf': { network: 'testnet', type: 'tpub' }, '044a5262': { network: 'testnet', type: 'upub' }, '045f1cf6': { network: 'testnet', type: 'vpub' }
  };
  const metadata = versions[version];
  if (!metadata || metadata.network !== network || (expectedType !== undefined && metadata.type !== expectedType) || (payload[45] !== 2 && payload[45] !== 3)) return { ok: false, code: 'invalid', message: 'Bitcoin extended public key version, network, or public key is invalid.' };
  return { ok: true, family: 'bitcoin', normalized: value, network, kind: metadata.type };
}

export function validateBitcoinAddress(value: string, network: BitcoinNetwork = 'mainnet', addressType: string = 'address'): AddressValidation {
  if (inputTooLong(value)) return tooLongFailure();
  if (typeof value !== 'string' || value === '') return { ok: false, code: 'invalid', message: 'Bitcoin address is empty.' };
  return addressType === 'address' ? bitcoinAddress(value, network) : bitcoinExtendedKey(value, network, addressType as BitcoinAddressType);
}

function decodeSolana(value: string): boolean {
  const decoded = decodeBase58(value);
  return decoded !== null && decoded.length === 32;
}

export function validateSolanaAddress(value: string): AddressValidation {
  if (inputTooLong(value)) return tooLongFailure();
  if (!decodeSolana(value)) return { ok: false, code: 'invalid', message: 'Solana public key must decode to exactly 32 bytes.' };
  return { ok: true, family: 'solana', normalized: value };
}

function validCardanoPointer(bytes: readonly number[]): boolean {
  if (bytes.length < 30 || bytes.length > 44) return false;
  let offset = 29;
  let components = 0;
  while (offset < bytes.length && components < 3) {
    let component = 0;
    let terminated = false;
    for (let count = 0; offset < bytes.length && count < 5; count++) {
      const byte = bytes[offset++]!;
      component = (component * 128) + (byte & 0x7f);
      if (component > 0xffffffff) return false;
      if ((byte & 0x80) === 0) { terminated = true; break; }
    }
    if (!terminated) return false;
    components++;
  }
  return components === 3 && offset === bytes.length;
}

export function validateCardanoAddress(value: string, expectedNetwork?: BitcoinNetwork): AddressValidation {
  if (inputTooLong(value)) return tooLongFailure();
  const decoded = decodeBech32(value, [1], 200);
  if (!decoded || !['addr', 'addr_test', 'stake', 'stake_test'].includes(decoded.hrp)) return { ok: false, code: 'invalid', message: 'Cardano address prefix or checksum is invalid.' };
  const bytes = convertBits(decoded.data, 5, 8, false);
  if (!bytes || bytes.length < 1) return { ok: false, code: 'invalid', message: 'Cardano address payload is invalid.' };
  const header = bytes[0]!;
  const type = header >>> 4;
  const networkTag = header & 0x0f;
  const network = networkTag === 1 ? 'mainnet' : networkTag === 0 ? 'testnet' : null;
  const stake = decoded.hrp.startsWith('stake');
  const validType = stake ? type === 14 || type === 15 : type >= 0 && type <= 7;
  const validLength = type <= 3 ? bytes.length === 57 : type === 4 || type === 5 ? validCardanoPointer(bytes) : type === 6 || type === 7 || type === 14 || type === 15 ? bytes.length === 29 : false;
  const hrpNetwork = decoded.hrp.endsWith('_test') ? 'testnet' : 'mainnet';
  if (!network || !validType || !validLength || network !== hrpNetwork || (expectedNetwork !== undefined && network !== expectedNetwork)) return { ok: false, code: 'invalid', message: 'Cardano CIP-19 address type, network tag, or payload length is invalid.' };
  return { ok: true, family: 'cardano', normalized: value, network, kind: stake ? 'stake' : 'address' };
}

export function validateAddressForFamily(value: string, family: WalletFamily, options: { readonly network?: BitcoinNetwork; readonly addressType?: string } = {}): AddressValidation {
  if (family === 'evm') return validateEvmAddress(value);
  if (family === 'bitcoin') {
    const addressType = options.addressType ?? 'address';
    if (options.network !== undefined) return validateBitcoinAddress(value, options.network, addressType);
    const mainnet = validateBitcoinAddress(value, 'mainnet', addressType);
    return mainnet.ok ? mainnet : validateBitcoinAddress(value, 'testnet', addressType);
  }
  if (family === 'solana') return validateSolanaAddress(value);
  return validateCardanoAddress(value, options.network);
}

export function detectAddress(value: string, additionalMatches: readonly AddressMatch[] = []): AddressDetection {
  if (inputTooLong(value)) return tooLongFailure();
  const matches = [
    validateEvmAddress(value),
    validateBitcoinAddress(value, 'mainnet'),
    validateBitcoinAddress(value, 'testnet'),
    validateBitcoinAddress(value, 'mainnet', 'xpub'),
    validateBitcoinAddress(value, 'mainnet', 'ypub'),
    validateBitcoinAddress(value, 'mainnet', 'zpub'),
    validateBitcoinAddress(value, 'testnet', 'tpub'),
    validateBitcoinAddress(value, 'testnet', 'upub'),
    validateBitcoinAddress(value, 'testnet', 'vpub'),
    validateSolanaAddress(value),
    validateCardanoAddress(value),
    ...additionalMatches
  ].filter((result): result is AddressMatch => result.ok);
  const families = [...new Set(matches.map(match => match.family))];
  if (families.length === 1 && matches[0]) return matches[0];
  if (families.length > 1) return { ok: false, code: 'ambiguous', message: 'Address matches more than one supported family.', candidates: families };
  return { ok: false, code: 'invalid', message: 'Address does not match a supported family.' };
}
