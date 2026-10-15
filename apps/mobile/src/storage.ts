import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { publicKeyFromSeed, verifyRotatingCode } from '@hypernova/contracts';
import type { SignedCredential } from '@hypernova/contracts';
import type { LocalScan, ScanDisplay, ScannerSetup, Ticket, WalletEntry } from './types';

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;
export function database(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) databasePromise = (async () => {
    const db = await SQLite.openDatabaseAsync('hypernova-ticketing.db');
    await db.execAsync(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS local_values (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wallet (account_id TEXT NOT NULL, ticket_id TEXT NOT NULL, ticket TEXT NOT NULL, credential TEXT,
        PRIMARY KEY(account_id, ticket_id));
      CREATE TABLE IF NOT EXISTS scan_attempts (client_scan_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, device_id TEXT NOT NULL,
        shift_id TEXT NOT NULL, ticket_id TEXT, event_id INTEGER NOT NULL, gate_id INTEGER NOT NULL, credential_version INTEGER,
        scanned_at TEXT NOT NULL, local_result TEXT NOT NULL, token TEXT NOT NULL, revocation_cursor TEXT, bootstrap_at TEXT,
        synced INTEGER NOT NULL DEFAULT 0, server_result TEXT);
      CREATE INDEX IF NOT EXISTS pending_scan_idx ON scan_attempts(account_id, device_id, synced, scanned_at);
      CREATE INDEX IF NOT EXISTS used_ticket_idx ON scan_attempts(event_id, ticket_id, local_result);`);
    return db;
  })();
  return databasePromise;
}
export async function getLocal<T>(key: string): Promise<T | null> {
  const row = await (await database()).getFirstAsync<{ value: string }>('SELECT value FROM local_values WHERE key = ?', key);
  if (!row) return null;
  try { return JSON.parse(row.value) as T; } catch { return null; }
}
export async function setLocal(key: string, value: unknown): Promise<void> {
  await (await database()).runAsync('INSERT INTO local_values(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
}
export async function removeLocal(key: string): Promise<void> { await (await database()).runAsync('DELETE FROM local_values WHERE key=?', key); }
export async function actionKey(accountId: string, operation: string): Promise<string> {
  const key = `action:${accountId}:${operation}`;
  const db = await database();
  let result = '';
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('INSERT INTO local_values(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING', key, JSON.stringify(Crypto.randomUUID()));
    const row = await tx.getFirstAsync<{ value: string }>('SELECT value FROM local_values WHERE key=?', key);
    if (!row) throw new Error('No se pudo conservar la clave de idempotencia.');
    result = JSON.parse(row.value) as string;
  });
  return result;
}
export async function finishAction(accountId: string, operation: string): Promise<void> { await removeLocal(`action:${accountId}:${operation}`); }
export async function holderKey(accountId: string, ticketId: string): Promise<{ seed: string; publicKey: string }> {
  const name = `hn-holder-${accountId}-${ticketId}`.replace(/[^a-zA-Z0-9._-]/g, '-');
  let seed = await SecureStore.getItemAsync(name);
  if (!seed) {
    const bytes = await Crypto.getRandomBytesAsync(32);
    seed = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(name, seed);
  }
  return { seed, publicKey: publicKeyFromSeed(seed) };
}
export async function cacheTickets(accountId: string, tickets: Ticket[]): Promise<void> {
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const existing = await tx.getAllAsync<{ ticket_id: string }>('SELECT ticket_id FROM wallet WHERE account_id=?', accountId);
    const currentIds = new Set(tickets.map((ticket) => ticket.id));
    for (const row of existing) if (!currentIds.has(row.ticket_id)) await tx.runAsync('DELETE FROM wallet WHERE account_id=? AND ticket_id=?', accountId, row.ticket_id);
    for (const ticket of tickets) {
      await tx.runAsync(`INSERT INTO wallet(account_id,ticket_id,ticket) VALUES(?,?,?) ON CONFLICT(account_id,ticket_id)
        DO UPDATE SET ticket=excluded.ticket,credential=CASE WHEN json_extract(wallet.ticket,'$.version')=json_extract(excluded.ticket,'$.version')
        AND json_extract(excluded.ticket,'$.state') IN ('paid','transferred') THEN wallet.credential ELSE NULL END`, accountId, ticket.id, JSON.stringify(ticket));
    }
  });
}
export async function cacheCredential(accountId: string, ticketId: string, credential: SignedCredential): Promise<void> {
  await (await database()).runAsync('UPDATE wallet SET credential=? WHERE account_id=? AND ticket_id=?', JSON.stringify(credential), accountId, ticketId);
}
export async function wallet(accountId: string): Promise<WalletEntry[]> {
  const rows = await (await database()).getAllAsync<{ ticket: string; credential: string | null }>('SELECT ticket,credential FROM wallet WHERE account_id=? ORDER BY json_extract(ticket,\'$.issuedAt\') DESC', accountId);
  return rows.map((row) => ({ ticket: JSON.parse(row.ticket) as Ticket, ...(row.credential ? { credential: JSON.parse(row.credential) as SignedCredential } : {}) }));
}
export async function scan(accountId: string, setup: ScannerSetup, raw: string): Promise<ScanDisplay> {
  const db = await database();
  const localNow = Date.now();
  const now = localNow + (setup.clockOffsetMs ?? 0);
  const verification = verifyRotatingCode(raw, setup.bootstrap.publicKeys, now / 1000, {
    eventId: setup.bootstrap.event.id,
    zoneIds: setup.bootstrap.gate.zoneIds.length ? setup.bootstrap.gate.zoneIds : setup.bootstrap.zones.map((zone) => zone.id),
    revocations: setup.bootstrap.revocations,
  });
  let localResult = verification.reason as ScanDisplay['result'];
  const snapshotAge = localNow - setup.downloadedAt;
  if (snapshotAge > (setup.bootstrap.maxOfflineHours ?? 72) * 3600000 || snapshotAge < -60000) localResult = 'expired';
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (localResult === 'valid' && verification.payload) {
      // A logical device registration changes with the gate; physical local admission history does not.
      const used = await tx.getFirstAsync('SELECT 1 FROM scan_attempts WHERE event_id=? AND ticket_id=? AND local_result=\'valid\' LIMIT 1', setup.bootstrap.event.id, verification.payload.ticketId);
      if (used) localResult = 'already_used';
    }
    await tx.runAsync(`INSERT INTO scan_attempts(client_scan_id,account_id,device_id,shift_id,ticket_id,event_id,gate_id,
      credential_version,scanned_at,local_result,token,revocation_cursor,bootstrap_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      Crypto.randomUUID(), accountId, setup.deviceId, setup.shiftId, verification.payload?.ticketId ?? null,
      setup.bootstrap.event.id, setup.bootstrap.gate.id, verification.payload?.version ?? null, new Date(now).toISOString(), localResult, raw.slice(0, 8192),
      setup.bootstrap.revocationCursor, new Date(setup.downloadedAt + (setup.clockOffsetMs ?? 0)).toISOString());
  });
  return { result: localResult, payload: verification.payload };
}
export async function pendingScans(accountId: string, deviceId: string, limit = 100): Promise<LocalScan[]> {
  return (await database()).getAllAsync<LocalScan>(`SELECT client_scan_id AS clientScanId,ticket_id AS ticketId,event_id AS eventId,
    gate_id AS gateId,credential_version AS credentialVersion,scanned_at AS scannedAt,local_result AS localResult,token,
    shift_id AS shiftId, revocation_cursor AS revocationCursor,bootstrap_at AS bootstrapAt
    FROM scan_attempts WHERE account_id=? AND device_id=? AND synced=0 ORDER BY scanned_at LIMIT ?`, accountId, deviceId, limit);
}
export async function pendingCount(accountId: string, deviceId: string): Promise<number> {
  const row = await (await database()).getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM scan_attempts WHERE account_id=? AND device_id=? AND synced=0', accountId, deviceId);
  return row?.count ?? 0;
}
export async function acknowledgeScans(results: { clientScanId: string; serverResult: string }[]): Promise<void> {
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const result of results) await tx.runAsync('UPDATE scan_attempts SET synced=1,server_result=? WHERE client_scan_id=?', result.serverResult, result.clientScanId);
  });
}
export async function recentScans(accountId: string, deviceId: string): Promise<LocalScan[]> {
  return (await database()).getAllAsync<LocalScan>(`SELECT client_scan_id AS clientScanId,ticket_id AS ticketId,event_id AS eventId,
    gate_id AS gateId,credential_version AS credentialVersion,scanned_at AS scannedAt,local_result AS localResult,token,
    server_result AS serverResult FROM scan_attempts WHERE account_id=? AND device_id=? ORDER BY scanned_at DESC LIMIT 30`, accountId, deviceId);
}
