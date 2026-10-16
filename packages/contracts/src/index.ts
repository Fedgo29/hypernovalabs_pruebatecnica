import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

export const ROTATION_SECONDS = 25;
export interface CredentialPayload {
  v: 1;
  kid: string;
  ticketId: string;
  eventId: number;
  zoneId: number;
  version: number;
  holderPublicKey: string;
  notBefore: number;
  expiresAt: number;
}
export interface SignedCredential { payload: CredentialPayload; signature: string }
export interface RotatingCode { credential: SignedCredential; slot: number; proofSignature: string }
export interface Revocation { ticketId: string; version: number }
export type ScanReason = 'valid' | 'expired' | 'revoked' | 'wrong_event' | 'wrong_zone' | 'invalid_signature';
export interface VerificationResult { valid: boolean; reason: ScanReason; payload?: CredentialPayload }
export interface VerificationContext { eventId: number; zoneIds?: readonly number[]; revocations?: readonly Revocation[] }
export type IssuerKeys = Readonly<Record<string, string>>;

const PAYLOAD_KEYS = ['v', 'kid', 'ticketId', 'eventId', 'zoneId', 'version', 'holderPublicKey', 'notBefore', 'expiresAt'];
const HEX_KEY = /^[0-9a-f]{64}$/;
const HEX_SIGNATURE = /^[0-9a-f]{128}$/;
const IDENTIFIER = /^[a-zA-Z0-9_.:-]{1,128}$/;

function objectWithKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
export function isCredentialPayload(value: unknown): value is CredentialPayload {
  if (!objectWithKeys(value, PAYLOAD_KEYS)) return false;
  return value.v === 1 && typeof value.kid === 'string' && IDENTIFIER.test(value.kid)
    && typeof value.ticketId === 'string' && IDENTIFIER.test(value.ticketId)
    && positiveInteger(value.eventId) && positiveInteger(value.zoneId) && positiveInteger(value.version)
    && typeof value.holderPublicKey === 'string' && HEX_KEY.test(value.holderPublicKey)
    && positiveInteger(value.notBefore) && positiveInteger(value.expiresAt) && value.expiresAt > value.notBefore;
}
function isSignedCredential(value: unknown): value is SignedCredential {
  return objectWithKeys(value, ['payload', 'signature']) && isCredentialPayload(value.payload)
    && typeof value.signature === 'string' && HEX_SIGNATURE.test(value.signature);
}
function ascii(value: string): Uint8Array {
  // All canonical fields are restricted to ASCII, avoiding platform TextEncoder dependencies.
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    const character = value.charCodeAt(i);
    if (character > 127) throw new Error('Non-ASCII canonical message');
    bytes[i] = character;
  }
  return bytes;
}
export function canonicalCredential(payload: CredentialPayload): string {
  if (!isCredentialPayload(payload)) throw new Error('Malformed credential payload');
  return JSON.stringify({
    v: payload.v, kid: payload.kid, ticketId: payload.ticketId, eventId: payload.eventId,
    zoneId: payload.zoneId, version: payload.version, holderPublicKey: payload.holderPublicKey,
    notBefore: payload.notBefore, expiresAt: payload.expiresAt,
  });
}
function credentialMessage(payload: CredentialPayload): Uint8Array {
  return ascii(`hypernova:credential:v1\n${canonicalCredential(payload)}`);
}
function proofMessage(credential: SignedCredential, slot: number): Uint8Array {
  // Bind possession to the exact issuer signature as well as its canonical payload.
  const digest = bytesToHex(sha256(ascii(`${canonicalCredential(credential.payload)}\n${credential.signature}`)));
  return ascii(`hypernova:possession:v1\n${digest}\n${slot}`);
}
function seedBytes(seed: string): Uint8Array {
  if (!HEX_KEY.test(seed)) throw new Error('Ed25519 seed must contain 32 bytes in lowercase hex');
  return hexToBytes(seed);
}
export function publicKeyFromSeed(seedHex: string): string {
  return bytesToHex(ed25519.getPublicKey(seedBytes(seedHex)));
}
export function signCredential(payload: CredentialPayload, privateSeedHex: string): SignedCredential {
  return { payload: { ...payload }, signature: bytesToHex(ed25519.sign(credentialMessage(payload), seedBytes(privateSeedHex))) };
}
export function verifyCredential(credential: unknown, trustedKeys: IssuerKeys): credential is SignedCredential {
  try {
    if (!isSignedCredential(credential)) return false;
    const key = trustedKeys[credential.payload.kid];
    if (typeof key !== 'string' || !HEX_KEY.test(key)) return false;
    return ed25519.verify(hexToBytes(credential.signature), credentialMessage(credential.payload), hexToBytes(key), { zip215: false });
  } catch { return false; }
}
export function signRotatingCode(credential: SignedCredential, holderSeedHex: string, nowSeconds: number): string {
  if (!isSignedCredential(credential) || !Number.isFinite(nowSeconds) || nowSeconds < 0) throw new Error('Malformed rotating code');
  if (publicKeyFromSeed(holderSeedHex) !== credential.payload.holderPublicKey) throw new Error('Holder key does not match credential');
  const slot = Math.floor(nowSeconds / ROTATION_SECONDS);
  const proofSignature = bytesToHex(ed25519.sign(proofMessage(credential, slot), seedBytes(holderSeedHex)));
  return JSON.stringify({ credential, slot, proofSignature });
}
export function parseRotatingCode(raw: string): RotatingCode | null {
  if (typeof raw !== 'string' || raw.length > 8192) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!objectWithKeys(value, ['credential', 'slot', 'proofSignature']) || !isSignedCredential(value.credential)
      || !positiveInteger(value.slot) || typeof value.proofSignature !== 'string' || !HEX_SIGNATURE.test(value.proofSignature)) return null;
    return value as unknown as RotatingCode;
  } catch { return null; }
}
export function verifyRotatingCode(raw: string, trustedKeys: IssuerKeys, nowSeconds: number, context: VerificationContext): VerificationResult {
  const invalid: VerificationResult = { valid: false, reason: 'invalid_signature' };
  try {
    if (!Number.isFinite(nowSeconds) || nowSeconds < 0) return invalid;
    const code = parseRotatingCode(raw);
    if (!code || !verifyCredential(code.credential, trustedKeys)) return invalid;
    const payload = code.credential.payload;
    if (!ed25519.verify(hexToBytes(code.proofSignature), proofMessage(code.credential, code.slot), hexToBytes(payload.holderPublicKey), { zip215: false })) return invalid;
    const result = (reason: ScanReason): VerificationResult => ({ valid: reason === 'valid', reason, payload });
    const currentSlot = Math.floor(nowSeconds / ROTATION_SECONDS);
    if (nowSeconds < payload.notBefore || nowSeconds >= payload.expiresAt || code.slot > currentSlot || code.slot < currentSlot - 1) return result('expired');
    if (payload.eventId !== context.eventId) return result('wrong_event');
    if (context.zoneIds && !context.zoneIds.includes(payload.zoneId)) return result('wrong_zone');
    if (context.revocations?.some((entry) => entry.ticketId === payload.ticketId && entry.version >= payload.version)) return result('revoked');
    return result('valid');
  } catch { return invalid; }
}

export interface User { id: string; email: string; name: string; role: 'asistente' | 'staff' | 'organizador' | 'admin' }
export interface AuthResponse { accessToken: string; refreshToken: string; user: User }
export interface ApiFailure { code: string; message: string; correlationId?: string }
