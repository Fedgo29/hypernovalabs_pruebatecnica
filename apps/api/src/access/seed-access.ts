import { createHash } from 'node:crypto';
import { PoolClient } from 'pg';

interface SeedScan {
  id: number; entrada_id: number; evento_id: number; puerta_id: number; staff_id: number;
  client_scan_id: string; escaneado_en: string; sincronizado_en: string; resultado: string;
}
interface AccessDataset { ingresos?: SeedScan[] }

function stableUuid(namespace: string): string {
  const bytes = createHash('sha256').update(namespace).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Core calls this inside its one-time, idempotent dataset seed transaction. */
export async function seedAccess(client: PoolClient, data: AccessDataset, shiftMs: number): Promise<void> {
  for (const row of data.ingresos ?? []) {
    const deviceId = stableUuid(`seed:device:${row.evento_id}:${row.puerta_id}:${row.staff_id}`);
    const shiftId = stableUuid(`seed:shift:${row.evento_id}:${row.puerta_id}:${row.staff_id}`);
    const scanId = stableUuid(`seed:scan:${row.client_scan_id}`);
    const userId = `staff-${row.staff_id}`;
    const ticketId = `ticket-${row.entrada_id}`;
    const scannedAt = new Date(Date.parse(row.escaneado_en) + shiftMs).toISOString();
    const syncedAt = new Date(Date.parse(row.sincronizado_en) + shiftMs).toISOString();
    const fingerprint = createHash('sha256').update(JSON.stringify(row)).digest('hex');
    await client.query(`INSERT INTO scanner_devices(id,owner_id,event_id,gate_id,name,registered_at,bootstrap_at,last_sync_at)
      VALUES($1,$2,$3,$4,'Dispositivo histórico dataset',$5,$5,$6) ON CONFLICT(id) DO NOTHING`, [deviceId, userId, row.evento_id, row.puerta_id, scannedAt, syncedAt]);
    await client.query(`INSERT INTO scanner_shifts(id,device_id,staff_id,event_id,gate_id,started_at,ended_at)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING`, [shiftId, deviceId, userId, row.evento_id, row.puerta_id, scannedAt, syncedAt]);
    const duplicate = await client.query('SELECT client_scan_id FROM scanner_admissions WHERE event_id=$1 AND ticket_id=$2', [row.evento_id, ticketId]);
    const serverResult = duplicate.rowCount ? 'double_ingress' : 'valid';
    const inserted = await client.query(`INSERT INTO scanner_attempts(client_scan_id,device_id,shift_id,staff_id,ticket_id,event_id,gate_id,credential_version,scanned_at,synced_at,local_result,server_result,payload_hash,evidence)
      VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9,'valid',$10,$11,$12) ON CONFLICT(client_scan_id) DO NOTHING RETURNING client_scan_id`, [scanId, deviceId, shiftId, userId, ticketId, row.evento_id, row.puerta_id, scannedAt, syncedAt, serverResult, fingerprint,
      { source: 'provided_dataset', originalClientScanId: row.client_scan_id, originalResult: row.resultado, cryptographicProofUnavailableForHistoricalFixture: true }]);
    if (!inserted.rowCount) continue;
    if (!duplicate.rowCount) {
      await client.query('INSERT INTO scanner_admissions(event_id,ticket_id,client_scan_id,gate_id,admitted_at,recorded_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(event_id,ticket_id) DO NOTHING', [row.evento_id, ticketId, scanId, row.puerta_id, scannedAt, syncedAt]);
      await client.query("UPDATE tickets SET state='used',used_at=$2 WHERE id=$1 AND state IN ('paid','transferred','used')", [ticketId, scannedAt]);
    } else {
      await client.query(`INSERT INTO scanner_incidents(event_id,device_id,client_scan_id,type,severity,details,created_at)
        VALUES($1,$2,$3,'double_ingress','critical',$4,$5)`, [row.evento_id, deviceId, scanId, { source: 'provided_dataset', ticketId, firstClientScanId: duplicate.rows[0].client_scan_id }, syncedAt]);
    }
  }
}
