import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool, PoolClient } from "pg";
import { hashPassword } from "./auth";
import { secrets } from "./runtime";
import { seedAccess } from "./access/seed-access";

type Row = Record<string, any>;
async function seed(client: PoolClient): Promise<void> {
  if (
    (
      await client.query(
        "SELECT value FROM seed_metadata WHERE key='dataset_v1'",
      )
    ).rowCount
  )
    return;
  const path =
    process.env.SEED_PATH ??
    resolve(__dirname, "../../../infra/data/seed-ticketing.json");
  const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
  const anchor = new Date();
  const shiftMs = anchor.getTime() - Date.parse(data.meta.referencia_temporal);
  const shift = (value: string | null): string | null =>
    value ? new Date(Date.parse(value) + shiftMs).toISOString() : null;
  const passwordHash = await hashPassword(secrets().demoPassword);
  for (const collection of [
    "usuarios_administrativos",
    "organizadores",
    "staff",
    "asistentes",
  ])
    for (const row of data[collection] as Row[]) {
      await client.query(
        "INSERT INTO users(id,email,password_hash,role,name,active) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING",
        [
          `${row.rol}-${row.id}`,
          row.email.toLowerCase(),
          passwordHash,
          row.rol,
          row.nombre,
          row.activo !== false,
        ],
      );
    }
  for (const row of data.eventos as Row[])
    await client.query(
      "INSERT INTO events(id,code,name,organizer_id,starts_at,sale_opens_at,refund_until,per_account_limit,status,venue) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        row.id,
        row.codigo,
        row.nombre,
        `organizador-${row.organizador_id}`,
        shift(row.fecha),
        shift(row.venta_abre),
        shift(row.reembolsable_hasta),
        row.limite_por_cuenta,
        row.estado,
        row.recinto,
      ],
    );
  for (const row of data.zonas as Row[])
    await client.query(
      "INSERT INTO zones(id,event_id,name,capacity) VALUES($1,$2,$3,$4)",
      [row.id, row.evento_id, row.nombre, row.aforo],
    );
  for (const row of data.fases_precio as Row[])
    await client.query(
      "INSERT INTO price_phases(id,zone_id,name,price_cents,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6)",
      [
        row.id,
        row.zona_id,
        row.fase,
        row.precio_centesimos,
        shift(row.desde),
        shift(row.hasta),
      ],
    );
  for (const row of data.puertas as Row[])
    await client.query("INSERT INTO gates(id,event_id,name) VALUES($1,$2,$3)", [
      row.id,
      row.evento_id,
      row.nombre,
    ]);
  for (const row of data.asignaciones_staff as Row[])
    await client.query(
      "INSERT INTO staff_assignments(event_id,user_id) VALUES($1,$2)",
      [row.evento_id, `staff-${row.staff_id}`],
    );
  for (const row of data.compras as Row[])
    await client.query(
      "INSERT INTO purchases(id,user_id,event_id,zone_id,quantity,unit_price_cents,amount_cents,state,paid_at,refunded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        `purchase-${row.id}`,
        `asistente-${row.asistente_id}`,
        row.evento_id,
        row.zona_id,
        row.cantidad,
        row.precio_unitario_centesimos,
        row.monto_centesimos,
        row.estado === "reembolsada" ? "refunded" : "paid",
        shift(row.pagada_en),
        shift(row.reembolsada_en),
      ],
    );
  const state: Record<string, string> = {
    pagada: "paid",
    transferida: "transferred",
    usada: "used",
    reembolsada: "refunded",
  };
  for (const row of data.entradas as Row[])
    await client.query(
      "INSERT INTO tickets(id,purchase_id,event_id,zone_id,holder_id,buyer_id,state,issued_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        `ticket-${row.id}`,
        `purchase-${row.compra_id}`,
        row.evento_id,
        row.zona_id,
        `asistente-${row.titular_id}`,
        `asistente-${row.comprador_id}`,
        state[row.estado],
        shift(row.emitida_en),
      ],
    );
  for (const row of data.transferencias as Row[])
    await client.query(
      "INSERT INTO transfers(id,ticket_id,from_user_id,to_user_id,state,created_at,resolved_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        `transfer-${row.id}`,
        `ticket-${row.entrada_id}`,
        `asistente-${row.de_usuario_id}`,
        `asistente-${row.a_usuario_id}`,
        row.estado === "aceptada" ? "accepted" : "pending",
        shift(row.creada_en),
        shift(row.resuelta_en),
      ],
    );
  for (const row of data.reservas as Row[]) {
    const zone = (
      await client.query("SELECT event_id FROM zones WHERE id=$1", [
        row.zona_id,
      ])
    ).rows[0];
    await client.query(
      "INSERT INTO reservations(id,user_id,event_id,zone_id,quantity,unit_price_cents,amount_cents,state,expires_at,created_at) VALUES($1,$2,$3,$4,$5,0,0,'expired',$6,$7)",
      [
        `reservation-${row.id}`,
        `asistente-${row.asistente_id}`,
        zone.event_id,
        row.zona_id,
        row.cantidad,
        shift(row.expira_en),
        shift(row.creada_en),
      ],
    );
  }
  await client.query(
    "UPDATE zones z SET sold_count=(SELECT COUNT(*) FROM tickets WHERE zone_id=z.id AND state NOT IN ('refunded','void'))",
  );
  await client.query(
    "INSERT INTO account_inventory(user_id,event_id,paid_count) SELECT buyer_id,event_id,COUNT(*)::int FROM tickets WHERE state NOT IN ('refunded','void') GROUP BY buyer_id,event_id",
  );
  await seedAccess(client, data, shiftMs);
  for (const table of ["events", "zones", "price_phases", "gates"])
    await client.query(
      `SELECT setval(pg_get_serial_sequence('${table}','id'),COALESCE((SELECT MAX(id) FROM ${table}),1),true)`,
    );
  await client.query(
    "INSERT INTO seed_metadata(key,value) VALUES('dataset_v1',$1),('anchor',$2),('reference',$3)",
    [
      String(data.meta.version),
      anchor.toISOString(),
      data.meta.referencia_temporal,
    ],
  );
}

export async function initializeDatabase(): Promise<void> {
  secrets();
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(77162000)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const directory =
      process.env.MIGRATIONS_DIR ?? resolve(__dirname, "../migrations");
    for (const filename of readdirSync(directory)
      .filter((name) => /^\d.*\.sql$/.test(name))
      .sort()) {
      if (
        (
          await client.query(
            "SELECT name FROM schema_migrations WHERE name=$1",
            [filename],
          )
        ).rowCount
      )
        continue;
      await client.query(readFileSync(resolve(directory, filename), "utf8"));
      await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [
        filename,
      ]);
    }
    await seed(client);
    if (process.env.DB_APP_PASSWORD) {
      const password = process.env.DB_APP_PASSWORD.replace(/'/g, "''");
      if (
        !(
          await client.query(
            "SELECT 1 FROM pg_roles WHERE rolname='hypernova_app'",
          )
        ).rowCount
      )
        await client.query(
          `CREATE ROLE hypernova_app LOGIN PASSWORD '${password}'`,
        );
      await client.query("GRANT USAGE ON SCHEMA public TO hypernova_app");
      await client.query(
        "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO hypernova_app",
      );
      await client.query(
        "GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO hypernova_app",
      );
      await client.query(
        "REVOKE UPDATE,DELETE ON audit_log,scanner_attempts,scanner_admissions,scanner_incidents FROM hypernova_app",
      );
      await client.query(
        "REVOKE ALL ON schema_migrations,seed_metadata FROM hypernova_app",
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
