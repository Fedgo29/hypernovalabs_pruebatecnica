import type { CredentialPayload, IssuerKeys, Revocation, SignedCredential } from '@hypernova/contracts';
export interface Zone { id: number; name: string; capacity: number; sold: number; reserved: number; available: number; priceCents: number | null }
export interface Gate { id: number; name: string; zoneIds: number[] }
export interface Event { id: number; name: string; startsAt: string; venue: string; refundUntil: string; perAccountLimit: number; zones: Zone[]; gates?: Gate[] }
export interface Page<T> { items: T[]; nextCursor: string | null }
export interface Reservation { id: string; state: string; eventId: number; zoneId: number; quantity: number; unitPriceCents: number; amountCents: number; expiresAt: string; paymentKey?: string }
export interface Ticket { id: string; eventId: number; eventName: string; zoneId: number; zoneName: string; state: string; version: number; issuedAt: string; purchaseId: string; amountCents: number; holderId: string }
export interface WalletEntry { ticket: Ticket; credential?: SignedCredential; seed?: string }
export interface Purchase { id: string; eventId?: number; eventName?: string; state: string; amountCents: number; createdAt?: string; paidAt?: string; refundedAt?: string; tickets?: Ticket[] }
export interface Transfer { id: string; ticketId: string; state: string; toEmail: string; fromUserId: string; toUserId: string; createdAt?: string }
export interface ScannerBootstrap {
  event: { id: number; name: string; date?: string };
  gate: Gate;
  zones: { id: number; name: string }[];
  publicKeys: IssuerKeys;
  revocations: (Revocation & { cursor?: string; reason?: string })[];
  revocationCursor: string;
  maxOfflineHours: number;
  serverTime?: string;
}
export interface ScannerSetup { deviceId: string; shiftId: string; bootstrap: ScannerBootstrap; downloadedAt: number; clockOffsetMs?: number }
export type LocalResult = 'valid' | 'already_used' | 'revoked' | 'expired' | 'wrong_event' | 'wrong_zone' | 'invalid_signature';
export interface LocalScan {
  clientScanId: string;
  ticketId: string | null;
  eventId: number;
  gateId: number;
  credentialVersion: number | null;
  scannedAt: string;
  localResult: LocalResult;
  token: string;
  shiftId?: string;
  serverResult?: string;
  revocationCursor?: string;
  bootstrapAt?: string;
}
export interface ScanDisplay { result: LocalResult; payload?: CredentialPayload }
