import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Uint8Array;
  decryptString(value: Uint8Array): string;
}

export interface EncryptedBlobStore {
  get(key: string): Uint8Array | null;
  set(key: string, value: Uint8Array): void;
  delete(key: string): void;
}

/** A small ciphertext-only, atomically replaced backing file for Electron userData. */
export class JsonEncryptedBlobStore implements EncryptedBlobStore {
  private readonly filename: string;
  public constructor(filename: string) { this.filename = filename; }

  private readAll(): Record<string, string> {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filename, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string'));
    } catch { return {}; }
  }

  private writeAll(values: Record<string, string>): void {
    mkdirSync(dirname(this.filename), { recursive: true, mode: 0o700 });
    const temporary = `${this.filename}.tmp`;
    writeFileSync(temporary, JSON.stringify(values), { encoding: 'utf8', mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.filename);
    chmodSync(this.filename, 0o600);
  }

  public get(key: string): Uint8Array | null {
    const value = this.readAll()[key];
    if (value === undefined) return null;
    return Uint8Array.from(Buffer.from(value, 'base64'));
  }

  public set(key: string, value: Uint8Array): void {
    const values = this.readAll();
    values[key] = Buffer.from(value).toString('base64');
    this.writeAll(values);
  }

  public delete(key: string): void {
    const values = this.readAll();
    delete values[key];
    this.writeAll(values);
  }
}

export type SecretErrorCode = 'unavailable' | 'invalid-id' | 'encrypt-failed' | 'decrypt-failed' | 'storage-failed';
export interface SecretError { readonly ok: false; readonly code: SecretErrorCode; readonly message: string; }
export interface SecretSuccess<T> { readonly ok: true; readonly value: T; }
export type SecretResult<T> = SecretSuccess<T> | SecretError;

export interface SecretStore {
  set(keyId: string, value: string): SecretResult<void>;
  get(keyId: string): SecretResult<string | null>;
  delete(keyId: string): SecretResult<void>;
}

function unavailable(): SecretError { return { ok: false, code: 'unavailable', message: 'Encrypted secret storage is unavailable.' }; }
function validId(keyId: unknown): keyId is string { return typeof keyId === 'string' && keyId.trim() !== ''; }
function availableNow(safeStorage: SafeStorageLike | undefined): boolean {
  try { return safeStorage !== undefined && safeStorage.isEncryptionAvailable(); } catch { return false; }
}

export function createSafeStorageSecretStore(safeStorage: SafeStorageLike | undefined, backing: EncryptedBlobStore): SecretStore {
  return {
    set(keyId, value) {
      if (!availableNow(safeStorage)) return unavailable();
      if (!validId(keyId) || typeof value !== 'string' || value === '') return { ok: false, code: 'invalid-id', message: 'Secret id and value must not be empty.' };
      try {
        const encrypted = safeStorage!.encryptString(value);
        try { backing.set(keyId, encrypted); return { ok: true, value: undefined }; } catch { return { ok: false, code: 'storage-failed', message: 'Encrypted secret storage failed.' }; }
      } catch { return { ok: false, code: 'encrypt-failed', message: 'Secret encryption failed.' }; }
    },
    get(keyId) {
      if (!availableNow(safeStorage)) return unavailable();
      if (!validId(keyId)) return { ok: false, code: 'invalid-id', message: 'Secret id must not be empty.' };
      let encrypted: Uint8Array | null;
      try { encrypted = backing.get(keyId); } catch { return { ok: false, code: 'storage-failed', message: 'Encrypted secret storage failed.' }; }
      if (encrypted === null) return { ok: true, value: null };
      try { return { ok: true, value: safeStorage!.decryptString(encrypted) }; } catch { return { ok: false, code: 'decrypt-failed', message: 'Secret decryption failed.' }; }
    },
    delete(keyId) {
      if (!availableNow(safeStorage)) return unavailable();
      if (!validId(keyId)) return { ok: false, code: 'invalid-id', message: 'Secret id must not be empty.' };
      try { backing.delete(keyId); return { ok: true, value: undefined }; } catch { return { ok: false, code: 'storage-failed', message: 'Encrypted secret storage failed.' }; }
    }
  };
}
