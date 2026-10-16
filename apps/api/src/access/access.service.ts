import { Inject, BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { ROTATION_SECONDS, verifyRotatingCode } from '@hypernova/contracts';
import { Db } from '../db';
import { secrets } from '../runtime';
import { dateValue, integer, stringValue } from '../validation';

export interface ScannerUser { id: string; role: 'asistente' | 'staff' | 'organizador' | 'admin' }
interface Device { id: string; owner_id: string; event_id: number; gate_id: number; name: string; registered_at: Date; bootstrap_at: Date | null; last_sync_at: Date | null; revocation_cursor: string; revoked_at: Date | null }
interface Attempt {
  clientScanId: string; ticketId: string | null; eventId: number; gateId: number;
  credentialVersion: number | null; scannedAt: string; localResult: string; token: string | null;
  revocationCursor?: string; bootstrapAt?: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESULTS = new Set(['valid', 'already_used', 'revoked', 'expired', 'wrong_event', 'wrong_zone', 'invalid_signature']);
function uuid(value: unknown, name: string): string {
  const input = stringValue(value, name, 36).toLowerCase();
  if (!UUID.test(input)) throw new BadRequestException({ code: 'INVALID_INPUT', message: `${name} must be a UUID` });
  return input;
}
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException({ code: 'INVALID_INPUT', message: `${name} must be an object` });
  return value as Record<string, unknown>;
}
function publicKeys(): Record<string, string> {
  const raw = createPublicKey(secrets().issuerPublicKey).export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
  return { [createHash('sha256').update(raw).digest('hex').slice(0, 16)]: raw };
}
function cursorValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '0';
  if (typeof value !== 'string' || !/^\d{1,19}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'cursor must be a nonnegative int64' });
  }
  return BigInt(value).toString();
}

@Injectable()
export class AccessService {
  constructor(@Inject(Db) private readonly db: Db) {}

  private async eventScope(user: ScannerUser, eventId: number, query: Pick<Db, 'query'> = this.db): Promise<void> {
    if (user.role !== 'staff' && user.role !== 'admin') throw new ForbiddenException({ code: 'STAFF_REQUIRED', message: 'Scanner access requires staff or admin role' });
    const event = await query.query('SELECT id FROM events WHERE id=$1', [eventId]);
    if (!event.rowCount) throw new NotFoundException({ code: 'EVENT_NOT_FOUND', message: 'Event not found' });
    if (user.role === 'staff') {
      const assignment = await query.query('SELECT 1 FROM staff_assignments WHERE event_id=$1 AND user_id=$2', [eventId, user.id]);
      if (!assignment.rowCount) throw new ForbiddenException({ code: 'EVENT_SCOPE_FORBIDDEN', message: 'Staff is not assigned to this event' });
    }
  }

  private async device(user: ScannerUser, id: string, query: Pick<Db, 'query'> = this.db): Promise<Device> {
    const result = await query.query<Device>('SELECT * FROM scanner_devices WHERE id=$1', [id]);
    const device = result.rows[0];
    if (!device) throw new NotFoundException({ code: 'DEVICE_NOT_FOUND', message: 'Scanner device not found' });
    await this.eventScope(user, device.event_id, query);
    // Admin can inspect a device in the portal, but cannot impersonate its scans.
    if (device.owner_id !== user.id) throw new ForbiddenException({ code: 'DEVICE_OWNER_REQUIRED', message: 'The device belongs to another account' });
    if (device.revoked_at) throw new ForbiddenException({ code: 'DEVICE_REVOKED', message: 'Scanner device has been revoked' });
    return device;
  }

  async register(user: ScannerUser, input: unknown): Promise<Record<string, unknown>> {
    const body = object(input, 'device');
    const deviceId = uuid(body.deviceId, 'deviceId');
    const eventId = integer(body.eventId, 'eventId');
    const gateId = integer(body.gateId, 'gateId');
    const name = body.name === undefined ? 'Escáner móvil' : stringValue(body.name, 'name', 100);
    await this.eventScope(user, eventId);
    const gate = await this.db.query('SELECT id FROM gates WHERE id=$1 AND event_id=$2', [gateId, eventId]);
    if (!gate.rowCount) throw new BadRequestException({ code: 'WRONG_GATE', message: 'Gate does not belong to the selected event' });
    await this.db.query(`INSERT INTO scanner_devices(id,owner_id,event_id,gate_id,name) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(id) DO NOTHING`, [deviceId, user.id, eventId, gateId, name]);
    const device = await this.device(user, deviceId);
    if (device.event_id !== eventId || device.gate_id !== gateId) throw new ConflictException({ code: 'DEVICE_SCOPE_CONFLICT', message: 'Use a new device identifier to change an event or gate; past attempts retain their original scope' });
    return { deviceId: device.id, eventId: device.event_id, gateId: device.gate_id, name: device.name };
  }

  async bootstrap(user: ScannerUser, deviceId: unknown): Promise<Record<string, unknown>> {
    const device = await this.device(user, uuid(deviceId, 'deviceId'));
    const [event, gate, zones, revoked] = await Promise.all([
      this.db.query('SELECT id,name,starts_at FROM events WHERE id=$1', [device.event_id]),
      this.db.query('SELECT id,name,zone_id FROM gates WHERE id=$1', [device.gate_id]),
      this.db.query('SELECT id,name FROM zones WHERE event_id=$1 ORDER BY id', [device.event_id]),
      this.revocationSnapshot(device.event_id),
    ]);
    await this.db.query('UPDATE scanner_devices SET bootstrap_at=now(),last_sync_at=now(),revocation_cursor=$2 WHERE id=$1', [device.id, revoked.revocationCursor]);
    const selectedGate = gate.rows[0];
    const zoneIds = selectedGate.zone_id ? [selectedGate.zone_id as number] : zones.rows.map((zone) => zone.id as number);
    return {
      deviceId: device.id,
      event: { id: event.rows[0].id, name: event.rows[0].name, date: event.rows[0].starts_at },
      gate: { id: selectedGate.id, name: selectedGate.name, zoneIds },
      zones: zones.rows,
      publicKeys: publicKeys(),
      ...revoked,
      serverTime: new Date().toISOString(),
      maxOfflineHours: this.maxOfflineHours(),
      rotationSeconds: ROTATION_SECONDS,
    };
  }

  private maxOfflineHours(): number {
    const configured = Number(process.env.SCANNER_MAX_OFFLINE_HOURS ?? 72);
    return Number.isFinite(configured) && configured > 0 && configured <= 720 ? configured : 72;
  }

  private async revocationSnapshot(eventId: number): Promise<{ revocations: Record<string, unknown>[]; revocationCursor: string }> {
    // Read the high-water mark BEFORE records. New commits cannot be skipped.
    // All core writers hold advisory lock 77162001 before allocating an ID.
    const watermark = await this.db.query('SELECT COALESCE(MAX(id),0)::text AS cursor FROM revocations');
    const cursor = watermark.rows[0].cursor as string;
    const rows = await this.db.query(`SELECT DISTINCT ON(r.ticket_id) r.id::text AS cursor,r.ticket_id AS "ticketId",r.version,r.reason
      FROM revocations r JOIN tickets t ON t.id=r.ticket_id WHERE t.event_id=$1 AND r.id<=$2
      ORDER BY r.ticket_id,r.version DESC,r.id DESC`, [eventId, cursor]);
    return { revocations: rows.rows, revocationCursor: cursor };
  }

  async revocations(user: ScannerUser, deviceId: unknown, after: unknown): Promise<Record<string, unknown>> {
    const device = await this.device(user, uuid(deviceId, 'deviceId'));
    const cursor = cursorValue(after);
    const watermark = await this.db.query('SELECT COALESCE(MAX(id),0)::text AS cursor FROM revocations');
    const highwater = watermark.rows[0].cursor as string;
    if (BigInt(cursor) > BigInt(highwater)) throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'Cursor is ahead of the server; rebootstrap the scanner' });
    const records = await this.db.query(`SELECT r.id::text AS cursor,r.ticket_id AS "ticketId",r.version,r.reason
      FROM revocations r JOIN tickets t ON t.id=r.ticket_id
      WHERE t.event_id=$1 AND r.id>$2 AND r.id<=$3 ORDER BY r.id LIMIT 1001`, [device.event_id, cursor, highwater]);
    const hasMore = records.rows.length > 1000;
    const revocations = records.rows.slice(0, 1000);
    const nextCursor = hasMore ? revocations[revocations.length - 1].cursor as string : highwater;
    await this.db.query('UPDATE scanner_devices SET last_sync_at=now(),revocation_cursor=GREATEST(revocation_cursor,$2) WHERE id=$1', [device.id, nextCursor]);
    return { revocations, revocationCursor: nextCursor, hasMore, serverTime: new Date().toISOString() };
  }

  async startShift(user: ScannerUser, input: unknown): Promise<Record<string, unknown>> {
    const body = object(input, 'shift');
    const device = await this.device(user, uuid(body.deviceId, 'deviceId'));
    if (!device.bootstrap_at) throw new ConflictException({ code: 'BOOTSTRAP_REQUIRED', message: 'Download trusted keys and revocations before opening a shift' });
    const id = randomUUID();
    await this.db.query('INSERT INTO scanner_shifts(id,device_id,staff_id,event_id,gate_id) VALUES($1,$2,$3,$4,$5)', [id, device.id, user.id, device.event_id, device.gate_id]);
    return { id, deviceId: device.id, eventId: device.event_id, gateId: device.gate_id, startedAt: new Date().toISOString() };
  }

  async endShift(user: ScannerUser, shiftId: unknown): Promise<Record<string, unknown>> {
    const id = uuid(shiftId, 'shiftId');
    const shift = await this.db.query('SELECT * FROM scanner_shifts WHERE id=$1', [id]);
    if (!shift.rowCount) throw new NotFoundException({ code: 'SHIFT_NOT_FOUND', message: 'Shift not found' });
    await this.device(user, shift.rows[0].device_id as string);
    await this.db.query('UPDATE scanner_shifts SET ended_at=COALESCE(ended_at,now()) WHERE id=$1', [id]);
    return { id, ended: true };
  }

  private parseAttempt(input: unknown): Attempt {
    const row = object(input, 'scan');
    const localResult = stringValue(row.localResult, 'localResult', 30);
    if (!RESULTS.has(localResult)) throw new BadRequestException({ code: 'INVALID_INPUT', message: 'Unsupported localResult' });
    const ticketId = row.ticketId === null || row.ticketId === undefined ? null : stringValue(row.ticketId, 'ticketId', 128);
    const credentialVersion = row.credentialVersion === null || row.credentialVersion === undefined ? null : integer(row.credentialVersion, 'credentialVersion');
    const token = row.token === null || row.token === undefined ? null : stringValue(row.token, 'token', 8192);
    if (localResult === 'valid' && (!ticketId || credentialVersion === null || !token)) throw new BadRequestException({ code: 'PROOF_REQUIRED', message: 'A locally accepted scan requires ticket, version and complete signed rotating token' });
    return {
      clientScanId: uuid(row.clientScanId, 'clientScanId'), ticketId,
      eventId: integer(row.eventId, 'eventId'), gateId: integer(row.gateId, 'gateId'),
      credentialVersion, scannedAt: dateValue(row.scannedAt, 'scannedAt'), localResult, token,
      ...(row.revocationCursor === undefined ? {} : { revocationCursor: cursorValue(row.revocationCursor) }),
      ...(row.bootstrapAt === undefined ? {} : { bootstrapAt: dateValue(row.bootstrapAt, 'bootstrapAt') }),
    };
  }

  async sync(user: ScannerUser, input: unknown): Promise<Record<string, unknown>> {
    const body = object(input, 'batch');
    const device = await this.device(user, uuid(body.deviceId, 'deviceId'));
    const shiftId = uuid(body.shiftId, 'shiftId');
    if (!Array.isArray(body.scans) || body.scans.length > 500) throw new BadRequestException({ code: 'INVALID_BATCH', message: 'scans must be an array with at most 500 attempts' });
    const scans = body.scans.map((scan) => this.parseAttempt(scan));
    const shiftResult = await this.db.query('SELECT * FROM scanner_shifts WHERE id=$1 AND device_id=$2 AND staff_id=$3', [shiftId, device.id, user.id]);
    const shift = shiftResult.rows[0];
    if (!shift) throw new ForbiddenException({ code: 'SHIFT_SCOPE_FORBIDDEN', message: 'Shift does not belong to the scanner and account' });
    if (scans.some((scan) => scan.eventId !== device.event_id || scan.gateId !== device.gate_id)) throw new ForbiddenException({ code: 'SCAN_SCOPE_FORBIDDEN', message: 'Every attempt must belong to the registered event and gate' });
    const results: Record<string, unknown>[] = [];
    // Each attempt commits independently: a lost response can be retried safely.
    // The response contains a stable result for every accepted UUID.
    for (const scan of scans) results.push(await this.processAttempt(user, device, shiftId, shift, scan));
    await this.db.query('UPDATE scanner_devices SET last_sync_at=now() WHERE id=$1', [device.id]);
    return { results, serverTime: new Date().toISOString() };
  }

  private async processAttempt(user: ScannerUser, device: Device, shiftId: string, shift: Record<string, unknown>, scan: Attempt): Promise<Record<string, unknown>> {
    const payloadHash = createHash('sha256').update(JSON.stringify({ deviceId: device.id, shiftId, ...scan })).digest('hex');
    return this.db.tx(async (client) => {
      // Serializes duplicate UUID submissions even when the ticket is unknown.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,77162002))', [scan.clientScanId]);
      const prior = await client.query('SELECT device_id,payload_hash,server_result FROM scanner_attempts WHERE client_scan_id=$1', [scan.clientScanId]);
      if (prior.rowCount) {
        const stored = prior.rows[0];
        if (stored.device_id !== device.id || stored.payload_hash !== payloadHash) {
          // Record attempted UUID reuse without modifying the original evidence.
          const existingConflict = await client.query(`SELECT id::text FROM scanner_incidents
            WHERE client_scan_id=$1 AND device_id=$2 AND type='scan_id_conflict'
            AND details->>'suppliedPayloadHash'=$3 LIMIT 1`, [scan.clientScanId, device.id, payloadHash]);
          const incidentId = existingConflict.rows[0]?.id as string | undefined
            ?? await this.incident(client, device, scan.clientScanId, 'scan_id_conflict', 'critical', { suppliedPayloadHash: payloadHash, existingPayloadHash: stored.payload_hash });
          return { clientScanId: scan.clientScanId, serverResult: 'id_conflict', incidentId, replayed: false };
        }
        const incident = await client.query('SELECT id::text FROM scanner_incidents WHERE client_scan_id=$1 AND type=$2 ORDER BY id LIMIT 1', [scan.clientScanId, stored.server_result]);
        return { clientScanId: scan.clientScanId, serverResult: stored.server_result, ...(incident.rowCount ? { incidentId: incident.rows[0].id } : {}), replayed: true };
      }
      // Recheck permissions and device revocation inside the committing transaction.
      await this.device(user, device.id, client);
      const now = Date.now();
      const scannedAt = Date.parse(scan.scannedAt);
      const ageMs = now - scannedAt;
      const maxAgeMs = this.maxOfflineHours() * 3600000;
      const shiftStartedAt = new Date(shift.started_at as string | Date).getTime();
      const shiftEndedAt = shift.ended_at ? new Date(shift.ended_at as string | Date).getTime() : null;
      const clockInvalid = scannedAt > now + 60000 || ageMs > maxAgeMs || scannedAt < shiftStartedAt - 60000 || (shiftEndedAt !== null && scannedAt > shiftEndedAt + 60000);
      const gate = await client.query('SELECT zone_id FROM gates WHERE id=$1 AND event_id=$2', [device.gate_id, device.event_id]);
      const zoneIds = gate.rows[0]?.zone_id ? [gate.rows[0].zone_id as number] : undefined;
      const proof = scan.token ? verifyRotatingCode(scan.token, publicKeys(), scannedAt / 1000, { eventId: device.event_id, zoneIds }) : { valid: false, reason: 'invalid_signature' as const, payload: undefined };
      let serverResult: string = clockInvalid ? 'clock_invalid' : proof.reason;
      let ticket: Record<string, unknown> | undefined;
      if (proof.valid && proof.payload && !clockInvalid) {
        const payload = proof.payload;
        if (scan.ticketId !== payload.ticketId || scan.credentialVersion !== payload.version) serverResult = 'invalid_signature';
        else {
          // All refund/transfer/void operations use the same ticket row lock.
          const locked = await client.query('SELECT * FROM tickets WHERE id=$1 FOR UPDATE', [payload.ticketId]);
          ticket = locked.rows[0];
          if (!ticket) serverResult = 'unknown_ticket';
          else if (ticket.event_id !== device.event_id) serverResult = 'wrong_event';
          else if (ticket.zone_id !== payload.zoneId) serverResult = 'wrong_zone';
          else if (ticket.version !== payload.version || ticket.holder_public_key !== payload.holderPublicKey || ['refunded', 'void'].includes(ticket.state as string)) serverResult = 'revoked';
          else {
            const revoked = await client.query('SELECT 1 FROM revocations WHERE ticket_id=$1 AND version>=$2 LIMIT 1', [payload.ticketId, payload.version]);
            if (revoked.rowCount) serverResult = 'revoked';
            else {
              const existing = await client.query('SELECT client_scan_id,gate_id,admitted_at FROM scanner_admissions WHERE event_id=$1 AND ticket_id=$2', [device.event_id, payload.ticketId]);
              if (existing.rowCount || ticket.state === 'used') serverResult = scan.localResult === 'valid' ? 'double_ingress' : 'already_used';
              else serverResult = scan.localResult === 'valid' ? 'valid' : scan.localResult;
            }
          }
        }
      }
      const evidence = {
        tokenHash: scan.token ? createHash('sha256').update(scan.token).digest('hex') : null,
        issuerKid: proof.payload?.kid ?? null,
        proofValidAtDeclaredTime: proof.valid,
        declaredTimeTrusted: false,
        ageMs: Math.max(0, ageMs),
        declaredRevocationCursorAtScan: scan.revocationCursor ?? null,
        serverRecordedRevocationCursorAtSync: device.revocation_cursor,
        declaredBootstrapAtScan: scan.bootstrapAt ?? null,
        serverRecordedBootstrapAtSync: device.bootstrap_at,
      };
      await client.query(`INSERT INTO scanner_attempts(client_scan_id,device_id,shift_id,staff_id,ticket_id,event_id,gate_id,credential_version,scanned_at,local_result,server_result,payload_hash,evidence)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [scan.clientScanId, device.id, shiftId, user.id, scan.ticketId, device.event_id, device.gate_id, scan.credentialVersion, scan.scannedAt, scan.localResult, serverResult, payloadHash, evidence]);
      if (serverResult === 'valid' && ticket) {
        await client.query('INSERT INTO scanner_admissions(event_id,ticket_id,client_scan_id,gate_id,admitted_at) VALUES($1,$2,$3,$4,$5)', [device.event_id, ticket.id, scan.clientScanId, device.gate_id, scan.scannedAt]);
        await client.query("UPDATE tickets SET state='used',used_at=$2 WHERE id=$1", [ticket.id, scan.scannedAt]);
      }
      let incidentId: string | undefined;
      if (serverResult === 'double_ingress') {
        const first = await client.query('SELECT client_scan_id,gate_id,admitted_at FROM scanner_admissions WHERE event_id=$1 AND ticket_id=$2', [device.event_id, scan.ticketId]);
        incidentId = await this.incident(client, device, scan.clientScanId, 'double_ingress', 'critical', { ticketId: scan.ticketId, secondGateId: device.gate_id, firstAdmission: first.rows[0] ?? null, locallyAccepted: true, physicalOrderUnknown: true });
      } else if (serverResult !== 'valid' && serverResult !== 'already_used') {
        incidentId = await this.incident(client, device, scan.clientScanId, serverResult, scan.localResult === 'valid' ? 'critical' : 'warning', { ticketId: scan.ticketId, localResult: scan.localResult, serverResult, ...evidence });
      }
      const snapshotAt = scan.bootstrapAt ?? device.bootstrap_at;
      if (scan.localResult === 'valid' && snapshotAt && scannedAt - new Date(snapshotAt).getTime() > 24 * 3600000) {
        await this.incident(client, device, scan.clientScanId, 'scanner_stale', 'warning', { bootstrapAt: snapshotAt, scannedAt: scan.scannedAt, declaredRevocationCursor: scan.revocationCursor ?? null });
      }
      return { clientScanId: scan.clientScanId, serverResult, ...(incidentId ? { incidentId } : {}), replayed: false };
    });
  }

  private async incident(client: PoolClient, device: Device, scanId: string, type: string, severity: string, details: Record<string, unknown>): Promise<string> {
    const result = await client.query('INSERT INTO scanner_incidents(event_id,device_id,client_scan_id,type,severity,details) VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text', [device.event_id, device.id, scanId, type, severity, details]);
    return result.rows[0].id as string;
  }
}
