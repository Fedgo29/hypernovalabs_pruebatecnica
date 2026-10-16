import { ROTATION_SECONDS } from '@hypernova/contracts';
import {
  Inject,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpException,
  Injectable,
  Module,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
} from "node:crypto";
import { PoolClient } from "pg";
import { signCredential } from "@hypernova/contracts";
import { AuthGuard, AuthRequest, Principal } from "./auth.guard";
interface AuthenticatedRequest extends AuthRequest {
  user: Principal;
}
import { Db } from "./db";
import { secrets } from "./runtime";
import { integer, stringValue } from "./validation";

function conflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}
function absent(): never {
  throw new NotFoundException({
    code: "NOT_FOUND",
    message: "Resource not found",
  });
}
export async function revoke(
  client: PoolClient,
  ticket: { id: string; version: number },
  reason: string,
): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(77162001)");
  await client.query(
    "INSERT INTO revocations(ticket_id,version,reason) VALUES($1,$2,$3)",
    [ticket.id, ticket.version, reason],
  );
}
export async function audit(
  client: PoolClient,
  actor: string,
  action: string,
  resource: string,
  reason?: string,
  details: unknown = {},
): Promise<void> {
  let eventId: number | null = null;
  if (
    action.startsWith("event.") ||
    action === "staff.assign" ||
    action === "staff.remove"
  )
    eventId = Number(resource);
  else if (action.startsWith("ticket."))
    eventId =
      (
        await client.query("SELECT event_id FROM tickets WHERE id=$1", [
          resource,
        ])
      ).rows[0]?.event_id ?? null;
  else if (action.startsWith("zone."))
    eventId =
      (
        await client.query("SELECT event_id FROM zones WHERE id=$1", [
          Number(resource),
        ])
      ).rows[0]?.event_id ?? null;
  else if (action.startsWith("gate."))
    eventId =
      (
        await client.query("SELECT event_id FROM gates WHERE id=$1", [
          Number(resource),
        ])
      ).rows[0]?.event_id ?? null;
  else if (action.startsWith("phase."))
    eventId =
      (
        await client.query(
          "SELECT z.event_id FROM price_phases p JOIN zones z ON z.id=p.zone_id WHERE p.id=$1",
          [Number(resource)],
        )
      ).rows[0]?.event_id ?? null;
  await client.query(
    "INSERT INTO audit_log(actor_id,action,resource,reason,details,event_id) VALUES($1,$2,$3,$4,$5,$6)",
    [actor, action, resource, reason ?? null, JSON.stringify(details), eventId],
  );
}
export async function expireZone(
  client: PoolClient,
  zoneId: number,
): Promise<void> {
  const expired = await client.query(
    "SELECT * FROM reservations WHERE zone_id=$1 AND state='active' AND expires_at<=statement_timestamp() ORDER BY id FOR UPDATE",
    [zoneId],
  );
  for (const row of expired.rows) {
    await client.query("UPDATE reservations SET state='expired' WHERE id=$1", [
      row.id,
    ]);
    await client.query(
      "UPDATE zones SET reserved_count=reserved_count-$2 WHERE id=$1",
      [zoneId, row.quantity],
    );
    await client.query(
      "UPDATE account_inventory SET reserved_count=reserved_count-$3 WHERE user_id=$1 AND event_id=$2",
      [row.user_id, row.event_id, row.quantity],
    );
  }
}
export async function eventPermission(
  client: {
    query(
      sql: string,
      args?: unknown[],
    ): Promise<{ rows: Record<string, any>[] }>;
  },
  actor: { id: string; role: string },
  eventId: number,
): Promise<void> {
  const result = await client.query(
    "SELECT organizer_id FROM events WHERE id=$1",
    [eventId],
  );
  if (!result.rows[0]) absent();
  if (
    actor.role !== "admin" &&
    !(actor.role === "organizador" && result.rows[0].organizer_id === actor.id)
  )
    throw new ForbiddenException({
      code: "EVENT_FORBIDDEN",
      message: "You cannot administer this event",
    });
}

@Injectable()
export class CommerceService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private sweeping = false;
  private readonly rate = new Map<string, { count: number; until: number }>();
  constructor(@Inject(Db) private readonly db: Db) {}
  onModuleInit(): void {
    this.timer = setInterval(
      () =>
        void this.sweep().catch((error) =>
          console.warn(
            JSON.stringify({
              level: "warn",
              message: "reservation_expiry_retry_next_tick",
              error: error instanceof Error ? error.message : "Unknown error",
            }),
          ),
        ),
      1000,
    );
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
  private limit(userId: string): void {
    const now = Date.now();
    const current = this.rate.get(userId);
    if (!current || current.until <= now)
      this.rate.set(userId, { count: 1, until: now + 60000 });
    else if (++current.count > 100)
      throw new HttpException(
        {
          code: "PURCHASE_RATE_LIMIT",
          message: "Too many purchase requests; retry after one minute",
        },
        429,
      );
    if (this.rate.size > 20000)
      for (const [key, value] of this.rate)
        if (value.until <= now) this.rate.delete(key);
  }
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const zones = await this.db.query(
        "SELECT DISTINCT zone_id FROM reservations WHERE state='active' AND expires_at<=statement_timestamp() ORDER BY zone_id",
      );
      for (const zone of zones.rows)
        await this.db.tx(async (client) => {
          await client.query("SELECT id FROM zones WHERE id=$1 FOR UPDATE", [
            zone.zone_id,
          ]);
          await expireZone(client, zone.zone_id);
        });
    } finally {
      this.sweeping = false;
    }
  }
  async idempotent<T>(
    userId: string,
    operation: string,
    keyInput: unknown,
    input: unknown,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const key = stringValue(keyInput, "Idempotency-Key", 128);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    return this.db.tx(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${userId}:${operation}:${key}`],
      );
      const previous = await client.query(
        "SELECT fingerprint,response FROM idempotency WHERE user_id=$1 AND operation=$2 AND key=$3",
        [userId, operation, key],
      );
      if (previous.rows[0]) {
        if (previous.rows[0].fingerprint !== fingerprint)
          conflict(
            "IDEMPOTENCY_CONFLICT",
            "This key was already used with another request",
          );
        return previous.rows[0].response as T;
      }
      const response = await work(client);
      await client.query(
        "INSERT INTO idempotency(user_id,operation,key,fingerprint,response) VALUES($1,$2,$3,$4,$5)",
        [userId, operation, key, fingerprint, JSON.stringify(response)],
      );
      return response;
    });
  }
  async reserve(
    userId: string,
    key: unknown,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    this.limit(userId);
    const zoneId = integer(body.zoneId, "zoneId");
    const quantity = integer(body.quantity, "quantity", 1, 20);
    return this.idempotent(
      userId,
      "reserve",
      key,
      { zoneId, quantity },
      async (client) => {
        const zone = (
          await client.query(
            "SELECT z.*,e.per_account_limit,e.sale_opens_at,e.starts_at,e.status FROM zones z JOIN events e ON e.id=z.event_id WHERE z.id=$1 FOR UPDATE OF z",
            [zoneId],
          )
        ).rows[0];
        if (!zone) absent();
        if (
          zone.status !== "en_venta" ||
          new Date(zone.sale_opens_at).getTime() > Date.now() ||
          new Date(zone.starts_at).getTime() <= Date.now()
        )
          conflict("SALE_CLOSED", "Sales are not open for this event");
        await expireZone(client, zoneId);
        await client.query(
          "INSERT INTO account_inventory(user_id,event_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [userId, zone.event_id],
        );
        const account = (
          await client.query(
            "SELECT * FROM account_inventory WHERE user_id=$1 AND event_id=$2 FOR UPDATE",
            [userId, zone.event_id],
          )
        ).rows[0];
        if (
          account.paid_count + account.reserved_count + quantity >
          zone.per_account_limit
        )
          conflict("ACCOUNT_LIMIT", "Per-account event limit reached");
        const phase = (
          await client.query(
            "SELECT * FROM price_phases WHERE zone_id=$1 AND starts_at<=statement_timestamp() AND ends_at>statement_timestamp() ORDER BY starts_at DESC,id DESC LIMIT 1",
            [zoneId],
          )
        ).rows[0];
        if (!phase)
          conflict("NO_ACTIVE_PRICE", "This zone has no active price phase");
        const updated = await client.query(
          "UPDATE zones SET reserved_count=reserved_count+$2 WHERE id=$1 AND sold_count+reserved_count+$2<=capacity RETURNING id",
          [zoneId, quantity],
        );
        if (!updated.rowCount)
          conflict("SOLD_OUT", "No capacity remains in this zone");
        await client.query(
          "UPDATE account_inventory SET reserved_count=reserved_count+$3 WHERE user_id=$1 AND event_id=$2",
          [userId, zone.event_id, quantity],
        );
        const id = randomUUID();
        const ttl = Math.max(
          1,
          Math.min(3600, Number(process.env.RESERVATION_TTL_SECONDS ?? 600)),
        );
        const row = (
          await client.query(
            "INSERT INTO reservations(id,user_id,event_id,zone_id,quantity,unit_price_cents,amount_cents,state,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,'active',statement_timestamp()+$8*interval '1 second') RETURNING *",
            [
              id,
              userId,
              zone.event_id,
              zoneId,
              quantity,
              phase.price_cents,
              phase.price_cents * quantity,
              ttl,
            ],
          )
        ).rows[0];
        return this.reservation(row);
      },
    );
  }
  private reservation(row: Record<string, any>): unknown {
    return {
      id: row.id,
      state: row.state,
      eventId: row.event_id,
      zoneId: row.zone_id,
      quantity: row.quantity,
      unitPriceCents: row.unit_price_cents,
      amountCents: row.amount_cents,
      expiresAt: row.expires_at,
    };
  }
  async getReservation(userId: string, id: string): Promise<unknown> {
    const row = (
      await this.db.query(
        "SELECT * FROM reservations WHERE id=$1 AND user_id=$2",
        [id, userId],
      )
    ).rows[0];
    if (!row) absent();
    return this.reservation(row);
  }
  async pay(
    userId: string,
    reservationId: string,
    key: unknown,
  ): Promise<unknown> {
    this.limit(userId);
    return this.idempotent(
      userId,
      "pay",
      key,
      { reservationId },
      async (client) => {
        const initial = (
          await client.query(
            "SELECT zone_id FROM reservations WHERE id=$1 AND user_id=$2",
            [reservationId, userId],
          )
        ).rows[0];
        if (!initial) absent();
        await client.query("SELECT id FROM zones WHERE id=$1 FOR UPDATE", [
          initial.zone_id,
        ]);
        await expireZone(client, initial.zone_id);
        let reservation = (
          await client.query(
            "SELECT *,expires_at<=statement_timestamp() AS elapsed FROM reservations WHERE id=$1 FOR UPDATE",
            [reservationId],
          )
        ).rows[0];
        if (reservation.state === "active" && reservation.elapsed) {
          await expireZone(client, initial.zone_id);
          reservation = (
            await client.query("SELECT * FROM reservations WHERE id=$1", [
              reservationId,
            ])
          ).rows[0];
        }
        if (reservation.state === "paid")
          return this.paidResult(client, reservationId);
        if (reservation.state === "expired") {
          await client.query(
            "INSERT INTO payment_ledger(id,reservation_id,user_id,kind,amount_cents) VALUES($1,$2,$3,'late_refund',$4) ON CONFLICT DO NOTHING",
            [randomUUID(), reservationId, userId, reservation.amount_cents],
          );
          return {
            reservationId,
            state: "late_refunded",
            amountCents: reservation.amount_cents,
            tickets: [],
            message:
              "The late simulated payment was automatically refunded; no ticket was issued",
          };
        }
        if (reservation.state !== "active")
          conflict("RESERVATION_CANCELLED", "This reservation was cancelled");
        const purchaseId = randomUUID();
        await client.query(
          "INSERT INTO purchases(id,reservation_id,user_id,event_id,zone_id,quantity,unit_price_cents,amount_cents,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'paid')",
          [
            purchaseId,
            reservationId,
            userId,
            reservation.event_id,
            reservation.zone_id,
            reservation.quantity,
            reservation.unit_price_cents,
            reservation.amount_cents,
          ],
        );
        await client.query(
          "INSERT INTO payment_ledger(id,reservation_id,user_id,kind,amount_cents) VALUES($1,$2,$3,'charge',$4)",
          [randomUUID(), reservationId, userId, reservation.amount_cents],
        );
        for (let i = 0; i < reservation.quantity; i++)
          await client.query(
            "INSERT INTO tickets(id,purchase_id,event_id,zone_id,holder_id,buyer_id,state) VALUES($1,$2,$3,$4,$5,$5,'paid')",
            [
              randomUUID(),
              purchaseId,
              reservation.event_id,
              reservation.zone_id,
              userId,
            ],
          );
        await client.query("UPDATE reservations SET state='paid' WHERE id=$1", [
          reservationId,
        ]);
        await client.query(
          "UPDATE zones SET reserved_count=reserved_count-$2,sold_count=sold_count+$2 WHERE id=$1",
          [reservation.zone_id, reservation.quantity],
        );
        await client.query(
          "UPDATE account_inventory SET reserved_count=reserved_count-$3,paid_count=paid_count+$3 WHERE user_id=$1 AND event_id=$2",
          [userId, reservation.event_id, reservation.quantity],
        );
        return this.paidResult(client, reservationId);
      },
    );
  }
  private async paidResult(
    client: PoolClient,
    reservationId: string,
  ): Promise<unknown> {
    const purchase = (
      await client.query("SELECT * FROM purchases WHERE reservation_id=$1", [
        reservationId,
      ])
    ).rows[0];
    const tickets = (
      await client.query(
        'SELECT id,event_id AS "eventId",zone_id AS "zoneId",state,version FROM tickets WHERE purchase_id=$1 ORDER BY id',
        [purchase.id],
      )
    ).rows;
    return {
      reservationId,
      purchaseId: purchase.id,
      state: "paid",
      amountCents: purchase.amount_cents,
      tickets,
    };
  }
  async cancel(userId: string, id: string): Promise<unknown> {
    return this.db.tx(async (client) => {
      const initial = (
        await client.query(
          "SELECT zone_id FROM reservations WHERE id=$1 AND user_id=$2",
          [id, userId],
        )
      ).rows[0];
      if (!initial) absent();
      await client.query("SELECT id FROM zones WHERE id=$1 FOR UPDATE", [
        initial.zone_id,
      ]);
      await expireZone(client, initial.zone_id);
      const row = (
        await client.query(
          "SELECT * FROM reservations WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (row.state === "paid")
        conflict("ALREADY_PAID", "Refund the issued ticket instead");
      if (row.state === "active") {
        await client.query(
          "UPDATE reservations SET state='cancelled' WHERE id=$1",
          [id],
        );
        await client.query(
          "UPDATE zones SET reserved_count=reserved_count-$2 WHERE id=$1",
          [row.zone_id, row.quantity],
        );
        await client.query(
          "UPDATE account_inventory SET reserved_count=reserved_count-$3 WHERE user_id=$1 AND event_id=$2",
          [userId, row.event_id, row.quantity],
        );
        row.state = "cancelled";
      }
      return this.reservation(row);
    });
  }
  async tickets(userId: string, cursor?: string): Promise<unknown> {
    const result = await this.db.query(
      'SELECT t.id,t.event_id AS "eventId",e.name AS "eventName",t.zone_id AS "zoneId",z.name AS "zoneName",t.state,t.version,t.issued_at AS "issuedAt",t.purchase_id AS "purchaseId",p.unit_price_cents AS "amountCents",t.holder_id AS "holderId" FROM tickets t JOIN events e ON e.id=t.event_id JOIN zones z ON z.id=t.zone_id JOIN purchases p ON p.id=t.purchase_id WHERE t.holder_id=$1 AND ($2::text IS NULL OR t.id>$2) ORDER BY t.id LIMIT 51',
      [userId, cursor ?? null],
    );
    const items = result.rows.slice(0, 50);
    return {
      items,
      nextCursor: result.rows.length > 50 ? items[items.length - 1]?.id : null,
    };
  }
  async credential(
    userId: string,
    id: string,
    holderPublicKey: unknown,
  ): Promise<unknown> {
    const publicKey = stringValue(holderPublicKey, "holderPublicKey", 64);
    if (!/^[a-f0-9]{64}$/i.test(publicKey))
      conflict(
        "INVALID_DEVICE_KEY",
        "holderPublicKey must be 32-byte Ed25519 hex",
      );
    const row = await this.db.tx(async (client) => {
      const ticket = (
        await client.query(
          "SELECT t.*,e.starts_at FROM tickets t JOIN events e ON e.id=t.event_id WHERE t.id=$1 AND t.holder_id=$2 FOR UPDATE OF t",
          [id, userId],
        )
      ).rows[0];
      if (!ticket) absent();
      if (!["paid", "transferred"].includes(ticket.state))
        conflict(
          "TICKET_NOT_VALID",
          "This ticket cannot issue an access credential",
        );
      if (new Date(ticket.starts_at).getTime() + 86400000 <= Date.now())
        conflict(
          "EVENT_ENDED",
          "This event no longer admits access credentials",
        );
      if (ticket.holder_public_key && ticket.holder_public_key !== publicKey) {
        await revoke(client, ticket, "device_key_changed");
        ticket.version += 1;
      }
      await client.query(
        "UPDATE tickets SET holder_public_key=$2,version=$3 WHERE id=$1",
        [id, publicKey, ticket.version],
      );
      return ticket;
    });
    const runtime = secrets();
    const issuerPrivateSeed = createPrivateKey(runtime.issuerPrivateKey)
      .export({ type: "pkcs8", format: "der" })
      .subarray(-32)
      .toString("hex");
    const issuerPublicKey = createPublicKey(runtime.issuerPublicKey)
      .export({ type: "spki", format: "der" })
      .subarray(-32)
      .toString("hex");
    const keyId = createHash("sha256")
      .update(issuerPublicKey)
      .digest("hex")
      .slice(0, 16);
    const payload = {
      v: 1 as const,
      kid: keyId,
      ticketId: row.id as string,
      eventId: row.event_id as number,
      zoneId: row.zone_id as number,
      version: row.version as number,
      holderPublicKey: publicKey,
      notBefore: Math.floor(Date.now() / 1000) - 60,
      expiresAt: Math.floor(new Date(row.starts_at).getTime() / 1000) + 86400,
    };
    return {
      credential: await signCredential(payload, issuerPrivateSeed),
      issuerPublicKey,
      keyId,
      slotSeconds: ROTATION_SECONDS,
    };
  }
  async transfer(
    userId: string,
    id: string,
    emailInput: unknown,
  ): Promise<unknown> {
    const email = stringValue(emailInput, "email", 254).toLowerCase();
    return this.db.tx(async (client) => {
      const recipient = (
        await client.query(
          "SELECT id FROM users WHERE email=$1 AND role='asistente' AND active=true",
          [email],
        )
      ).rows[0];
      if (!recipient) absent();
      if (recipient.id === userId)
        conflict("SELF_TRANSFER", "Choose another attendee");
      const ticket = (
        await client.query(
          "SELECT * FROM tickets WHERE id=$1 AND holder_id=$2 FOR UPDATE",
          [id, userId],
        )
      ).rows[0];
      if (!ticket) absent();
      if (!["paid", "transferred"].includes(ticket.state))
        conflict(
          "TRANSFER_NOT_ALLOWED",
          "Used or cancelled tickets cannot transfer",
        );
      if (
        (
          await client.query(
            "SELECT id FROM transfers WHERE ticket_id=$1 AND state='pending'",
            [id],
          )
        ).rowCount
      )
        conflict("TRANSFER_PENDING", "A transfer is already pending");
      const transferId = randomUUID();
      await client.query(
        "INSERT INTO transfers(id,ticket_id,from_user_id,to_user_id,state) VALUES($1,$2,$3,$4,'pending')",
        [transferId, id, userId, recipient.id],
      );
      return { id: transferId, ticketId: id, state: "pending", toEmail: email };
    });
  }
  async transfers(userId: string): Promise<unknown> {
    return {
      items: (
        await this.db.query(
          'SELECT t.id,t.ticket_id AS "ticketId",t.state,t.from_user_id AS "fromUserId",t.to_user_id AS "toUserId",u.email AS "toEmail",t.created_at AS "createdAt" FROM transfers t JOIN users u ON u.id=t.to_user_id WHERE t.from_user_id=$1 OR t.to_user_id=$1 ORDER BY t.created_at DESC LIMIT 100',
          [userId],
        )
      ).rows,
    };
  }
  async resolveTransfer(
    userId: string,
    id: string,
    accept: boolean,
  ): Promise<unknown> {
    return this.db.tx(async (client) => {
      const initial = (
        await client.query("SELECT ticket_id FROM transfers WHERE id=$1", [id])
      ).rows[0];
      if (!initial) absent();
      const ticket = (
        await client.query("SELECT * FROM tickets WHERE id=$1 FOR UPDATE", [
          initial.ticket_id,
        ])
      ).rows[0];
      const transfer = (
        await client.query("SELECT * FROM transfers WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0];
      if ((accept ? transfer.to_user_id : transfer.from_user_id) !== userId)
        throw new ForbiddenException({
          code: "TRANSFER_FORBIDDEN",
          message: "This transfer does not belong to you",
        });
      if (transfer.state === (accept ? "accepted" : "cancelled"))
        return { id, state: transfer.state, ticketId: ticket.id };
      if (transfer.state !== "pending")
        conflict("TRANSFER_RESOLVED", "This transfer was already resolved");
      if (accept) {
        if (
          !["paid", "transferred"].includes(ticket.state) ||
          ticket.holder_id !== transfer.from_user_id
        )
          conflict(
            "TRANSFER_NOT_ALLOWED",
            "The ticket changed while this transfer was pending",
          );
        await revoke(client, ticket, "transferred");
        await client.query(
          "UPDATE tickets SET holder_id=$2,state='transferred',version=version+1,holder_public_key=NULL WHERE id=$1",
          [ticket.id, userId],
        );
      }
      const state = accept ? "accepted" : "cancelled";
      await client.query(
        "UPDATE transfers SET state=$2,resolved_at=now() WHERE id=$1",
        [id, state],
      );
      await audit(
        client,
        userId,
        accept ? "ticket.transfer.accept" : "ticket.transfer.cancel",
        ticket.id,
      );
      return { id, state, ticketId: ticket.id };
    });
  }
  async refund(
    actor: { id: string; role: string },
    id: string,
    key: unknown,
    reasonInput: unknown,
    administrative = false,
    voidOnly = false,
  ): Promise<unknown> {
    const reason = stringValue(
      reasonInput ?? "Attendee requested refund",
      "reason",
      500,
    );
    return this.idempotent(
      actor.id,
      voidOnly ? "void" : "refund",
      key,
      { id, reason },
      async (client) => {
        const initial = (
          await client.query(
            "SELECT zone_id,event_id FROM tickets WHERE id=$1",
            [id],
          )
        ).rows[0];
        if (!initial) absent();
        if (administrative)
          await eventPermission(client, actor, initial.event_id);
        await client.query("SELECT id FROM zones WHERE id=$1 FOR UPDATE", [
          initial.zone_id,
        ]);
        const ticket = (
          await client.query(
            "SELECT t.*,e.refund_until,p.unit_price_cents FROM tickets t JOIN events e ON e.id=t.event_id JOIN purchases p ON p.id=t.purchase_id WHERE t.id=$1 FOR UPDATE OF t",
            [id],
          )
        ).rows[0];
        if (!administrative && ticket.holder_id !== actor.id)
          throw new ForbiddenException({
            code: "TICKET_FORBIDDEN",
            message: "This ticket does not belong to you",
          });
        if (ticket.state === "used")
          conflict("TICKET_USED", "A used ticket cannot be refunded or voided");
        if (ticket.state === "refunded" || ticket.state === "void")
          conflict("TICKET_CANCELLED", "This ticket was already cancelled");
        if (!voidOnly && new Date(ticket.refund_until).getTime() < Date.now())
          conflict("REFUND_CLOSED", "The refund deadline has passed");
        await revoke(client, ticket, voidOnly ? "voided" : "refunded");
        await client.query(
          "UPDATE tickets SET state=$2,version=version+1 WHERE id=$1",
          [id, voidOnly ? "void" : "refunded"],
        );
        await client.query(
          "UPDATE transfers SET state='cancelled',resolved_at=now() WHERE ticket_id=$1 AND state='pending'",
          [id],
        );
        await client.query(
          "UPDATE zones SET sold_count=sold_count-1 WHERE id=$1",
          [ticket.zone_id],
        );
        await client.query(
          "UPDATE account_inventory SET paid_count=paid_count-1 WHERE user_id=$1 AND event_id=$2",
          [ticket.buyer_id, ticket.event_id],
        );
        if (!voidOnly)
          await client.query(
            "INSERT INTO payment_ledger(id,ticket_id,user_id,kind,amount_cents) VALUES($1,$2,$3,'refund',$4)",
            [randomUUID(), id, ticket.buyer_id, ticket.unit_price_cents],
          );
        await client.query(
          "UPDATE purchases SET state='refunded',refunded_at=now() WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM tickets WHERE purchase_id=$1 AND state NOT IN ('refunded','void'))",
          [ticket.purchase_id],
        );
        await audit(
          client,
          actor.id,
          voidOnly ? "ticket.void" : "ticket.refund",
          id,
          reason,
          { amountCents: voidOnly ? 0 : ticket.unit_price_cents },
        );
        return {
          id,
          state: voidOnly ? "void" : "refunded",
          amountCents: voidOnly ? 0 : ticket.unit_price_cents,
        };
      },
    );
  }
  async purchases(userId: string, cursor?: string): Promise<unknown> {
    const result = await this.db.query(
      'SELECT id,event_id AS "eventId",zone_id AS "zoneId",quantity,amount_cents AS "amountCents",state,paid_at AS "paidAt",refunded_at AS "refundedAt" FROM purchases WHERE user_id=$1 AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT 51',
      [userId, cursor ?? null],
    );
    const items = result.rows.slice(0, 50);
    return {
      items,
      nextCursor: result.rows.length > 50 ? items[items.length - 1]?.id : null,
    };
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class CommerceController {
  constructor(
    @Inject(CommerceService) private readonly commerce: CommerceService,
  ) {}
  @Post("reservations") reserve(
    @Req() req: AuthenticatedRequest,
    @Headers("idempotency-key") key: unknown,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.commerce.reserve(req.user.id, key, body);
  }
  @Get("reservations/:id") reservation(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<unknown> {
    return this.commerce.getReservation(req.user.id, id);
  }
  @Post("reservations/:id/pay") pay(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: unknown,
  ): Promise<unknown> {
    return this.commerce.pay(req.user.id, id, key);
  }
  @Post("reservations/:id/cancel") cancel(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<unknown> {
    return this.commerce.cancel(req.user.id, id);
  }
  @Get("tickets") tickets(
    @Req() req: AuthenticatedRequest,
    @Query("cursor") cursor?: string,
  ): Promise<unknown> {
    return this.commerce.tickets(req.user.id, cursor);
  }
  @Post("tickets/:id/credential") credential(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.commerce.credential(req.user.id, id, body.holderPublicKey);
  }
  @Post("tickets/:id/transfers") transfer(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.commerce.transfer(req.user.id, id, body.email);
  }
  @Get("transfers") transfers(
    @Req() req: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.commerce.transfers(req.user.id);
  }
  @Post("transfers/:id/accept") accept(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<unknown> {
    return this.commerce.resolveTransfer(req.user.id, id, true);
  }
  @Post("transfers/:id/cancel") cancelTransfer(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<unknown> {
    return this.commerce.resolveTransfer(req.user.id, id, false);
  }
  @Post("tickets/:id/refund") refund(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: unknown,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.commerce.refund(req.user, id, key, body.reason);
  }
  @Get("purchases") purchases(
    @Req() req: AuthenticatedRequest,
    @Query("cursor") cursor?: string,
  ): Promise<unknown> {
    return this.commerce.purchases(req.user.id, cursor);
  }
}
@Module({
  controllers: [CommerceController],
  providers: [CommerceService],
  exports: [CommerceService],
})
export class CommerceModule {}
