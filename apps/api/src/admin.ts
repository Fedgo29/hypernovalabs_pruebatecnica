import {
  Inject,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, AuthRequest, Principal } from "./auth.guard";
interface AuthenticatedRequest extends AuthRequest {
  user: Principal;
}
import {
  CommerceModule,
  CommerceService,
  audit,
  eventPermission,
} from "./commerce";
import { Db } from "./db";
import { EventsModule, EventsService } from "./events";
import { dateValue, integer, stringValue } from "./validation";

@Injectable()
export class AdminService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
  ) {}
  checkRole(actor: { role: string }): void {
    if (!["admin", "organizador"].includes(actor.role))
      throw new ForbiddenException({
        code: "ADMIN_FORBIDDEN",
        message: "An organizer or admin role is required",
      });
  }
  async list(
    actor: { id: string; role: string },
    cursor?: string,
  ): Promise<unknown> {
    this.checkRole(actor);
    const result = await this.events.list(
      cursor,
      actor.role === "organizador" ? actor.id : undefined,
      true,
    );
    const assignments = (
      await this.db.query(
        "SELECT s.event_id,u.id,u.name,u.email FROM staff_assignments s JOIN users u ON u.id=s.user_id WHERE s.event_id=ANY($1::int[]) ORDER BY u.id",
        [result.items.map((event: any) => event.id)],
      )
    ).rows;
    return {
      ...result,
      items: result.items.map((event: any) => ({
        ...event,
        staff: assignments
          .filter((row) => row.event_id === event.id)
          .map(({ event_id, ...user }) => user),
      })),
    };
  }
  async create(
    actor: { id: string; role: string },
    body: Record<string, unknown>,
  ): Promise<unknown> {
    this.checkRole(actor);
    const name = stringValue(body.name, "name");
    const startsAt = dateValue(body.startsAt, "startsAt");
    const saleOpensAt = dateValue(body.saleOpensAt, "saleOpensAt");
    const refundUntil = dateValue(body.refundUntil, "refundUntil");
    const perAccountLimit = integer(
      body.perAccountLimit,
      "perAccountLimit",
      1,
      100,
    );
    const venue = stringValue(body.venue ?? "Recinto", "venue");
    if (
      Date.parse(refundUntil) >= Date.parse(startsAt) ||
      Date.parse(saleOpensAt) >= Date.parse(startsAt)
    )
      throw new ConflictException({
        code: "INVALID_DATES",
        message: "Refund and sale dates must be before the event",
      });
    const organizerId =
      actor.role === "admin" && body.organizerId
        ? stringValue(body.organizerId, "organizerId")
        : actor.id;
    return this.db.tx(async (client) => {
      const owner = (
        await client.query("SELECT role FROM users WHERE id=$1", [organizerId])
      ).rows[0];
      if (!owner || !["admin", "organizador"].includes(owner.role))
        throw new ConflictException({
          code: "INVALID_ORGANIZER",
          message: "Choose an organizer account",
        });
      const status = body.status === "proximo" ? "proximo" : "en_venta";
      const row = (
        await client.query(
          "INSERT INTO events(name,organizer_id,starts_at,sale_opens_at,refund_until,per_account_limit,status,venue) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
          [
            name,
            organizerId,
            startsAt,
            saleOpensAt,
            refundUntil,
            perAccountLimit,
            status,
            venue,
          ],
        )
      ).rows[0];
      await audit(client, actor.id, "event.create", String(row.id));
      return {
        id: row.id,
        name,
        organizerId,
        startsAt,
        saleOpensAt,
        refundUntil,
        perAccountLimit,
        status,
        venue,
        zones: [],
        gates: [],
        phases: [],
      };
    });
  }
  async update(
    actor: { id: string; role: string },
    id: number,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    this.checkRole(actor);
    await this.db.tx(async (client) => {
      await eventPermission(client, actor, id);
      const previous = (
        await client.query("SELECT * FROM events WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      const name =
        body.name === undefined
          ? previous.name
          : stringValue(body.name, "name");
      const startsAt =
        body.startsAt === undefined
          ? previous.starts_at
          : dateValue(body.startsAt, "startsAt");
      const saleOpensAt =
        body.saleOpensAt === undefined
          ? previous.sale_opens_at
          : dateValue(body.saleOpensAt, "saleOpensAt");
      const refundUntil =
        body.refundUntil === undefined
          ? previous.refund_until
          : dateValue(body.refundUntil, "refundUntil");
      const limit =
        body.perAccountLimit === undefined
          ? previous.per_account_limit
          : integer(body.perAccountLimit, "perAccountLimit", 1, 100);
      const status =
        body.status === undefined
          ? previous.status
          : stringValue(body.status, "status", 20);
      if (!["en_venta", "proximo", "finalizado", "cancelado"].includes(status))
        throw new ConflictException({
          code: "INVALID_STATUS",
          message: "Invalid event status",
        });
      if (
        new Date(refundUntil).getTime() >= new Date(startsAt).getTime() ||
        new Date(saleOpensAt).getTime() >= new Date(startsAt).getTime()
      )
        throw new ConflictException({
          code: "INVALID_DATES",
          message: "Refund and sale dates must be before the event",
        });
      await client.query(
        "UPDATE events SET name=$2,starts_at=$3,sale_opens_at=$4,refund_until=$5,per_account_limit=$6,status=$7,venue=$8 WHERE id=$1",
        [
          id,
          name,
          startsAt,
          saleOpensAt,
          refundUntil,
          limit,
          status,
          body.venue === undefined
            ? previous.venue
            : stringValue(body.venue, "venue"),
        ],
      );
      await audit(client, actor.id, "event.update", String(id));
    });
    this.events.invalidate(id);
    return this.events.detail(id, true);
  }
  async zone(
    actor: { id: string; role: string },
    eventId: number,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    this.checkRole(actor);
    const name = stringValue(body.name, "name");
    const capacity = integer(body.capacity, "capacity", 1, 1000000);
    return this.db.tx(async (client) => {
      await eventPermission(client, actor, eventId);
      const row = (
        await client.query(
          "INSERT INTO zones(event_id,name,capacity) VALUES($1,$2,$3) RETURNING id,name,capacity",
          [eventId, name, capacity],
        )
      ).rows[0];
      await audit(client, actor.id, "zone.create", String(row.id));
      return {
        ...row,
        eventId,
        sold: 0,
        reserved: 0,
        available: capacity,
        priceCents: null,
      };
    });
  }
  async updateZone(
    actor: { id: string; role: string },
    zoneId: number,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    this.checkRole(actor);
    return this.db.tx(async (client) => {
      const zone = (
        await client.query("SELECT * FROM zones WHERE id=$1 FOR UPDATE", [
          zoneId,
        ])
      ).rows[0];
      if (!zone)
        throw new ConflictException({
          code: "INVALID_ZONE",
          message: "Zone not found",
        });
      await eventPermission(client, actor, zone.event_id);
      const name =
        body.name === undefined ? zone.name : stringValue(body.name, "name");
      const capacity =
        body.capacity === undefined
          ? zone.capacity
          : integer(body.capacity, "capacity", 1, 1000000);
      if (capacity < zone.sold_count + zone.reserved_count)
        throw new ConflictException({
          code: "CAPACITY_CONFLICT",
          message: "Capacity is below occupied inventory",
        });
      await client.query("UPDATE zones SET name=$2,capacity=$3 WHERE id=$1", [
        zoneId,
        name,
        capacity,
      ]);
      await audit(client, actor.id, "zone.update", String(zoneId));
      return { id: zoneId, name, capacity };
    });
  }
  async phase(
    actor: { id: string; role: string },
    eventId: number,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    this.checkRole(actor);
    const zoneId = integer(body.zoneId, "zoneId");
    const name = stringValue(body.name, "name");
    const priceCents = integer(body.priceCents, "priceCents", 0, 10000000);
    const startsAt = dateValue(body.startsAt, "startsAt");
    const endsAt = dateValue(body.endsAt, "endsAt");
    if (Date.parse(endsAt) <= Date.parse(startsAt))
      throw new ConflictException({
        code: "INVALID_DATES",
        message: "Phase end must follow start",
      });
    return this.db.tx(async (client) => {
      await eventPermission(client, actor, eventId);
      const zone = (
        await client.query(
          "SELECT id FROM zones WHERE id=$1 AND event_id=$2 FOR UPDATE",
          [zoneId, eventId],
        )
      ).rows[0];
      if (!zone)
        throw new ConflictException({
          code: "INVALID_ZONE",
          message: "Zone does not belong to event",
        });
      const overlap = await client.query(
        "SELECT id FROM price_phases WHERE zone_id=$1 AND starts_at<$3 AND ends_at>$2",
        [zoneId, startsAt, endsAt],
      );
      if (overlap.rowCount)
        throw new ConflictException({
          code: "PRICE_OVERLAP",
          message: "Price phases cannot overlap",
        });
      const row = (
        await client.query(
          "INSERT INTO price_phases(zone_id,name,price_cents,starts_at,ends_at) VALUES($1,$2,$3,$4,$5) RETURNING id",
          [zoneId, name, priceCents, startsAt, endsAt],
        )
      ).rows[0];
      await audit(client, actor.id, "phase.create", String(row.id));
      return { id: row.id, zoneId, name, priceCents, startsAt, endsAt };
    });
  }
  async gate(
    actor: { id: string; role: string },
    eventId: number,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    this.checkRole(actor);
    const name = stringValue(body.name, "name");
    const zoneId =
      body.zoneId === undefined || body.zoneId === null
        ? null
        : integer(body.zoneId, "zoneId");
    return this.db.tx(async (client) => {
      await eventPermission(client, actor, eventId);
      if (
        zoneId !== null &&
        !(
          await client.query(
            "SELECT id FROM zones WHERE id=$1 AND event_id=$2",
            [zoneId, eventId],
          )
        ).rowCount
      )
        throw new ConflictException({
          code: "INVALID_ZONE",
          message: "Zone does not belong to event",
        });
      const row = (
        await client.query(
          "INSERT INTO gates(event_id,name,zone_id) VALUES($1,$2,$3) RETURNING id",
          [eventId, name, zoneId],
        )
      ).rows[0];
      await audit(client, actor.id, "gate.create", String(row.id));
      return { id: row.id, name, zoneIds: zoneId === null ? [] : [zoneId] };
    });
  }
  async staff(
    actor: { id: string; role: string },
    eventId: number,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    this.checkRole(actor);
    const userId = stringValue(body.userId, "userId");
    return this.db.tx(async (client) => {
      await eventPermission(client, actor, eventId);
      const user = (
        await client.query(
          "SELECT id,name,email FROM users WHERE id=$1 AND role='staff' AND active=true",
          [userId],
        )
      ).rows[0];
      if (!user)
        throw new ConflictException({
          code: "INVALID_STAFF",
          message: "Choose a staff account",
        });
      await client.query(
        "INSERT INTO staff_assignments(event_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [eventId, userId],
      );
      await audit(
        client,
        actor.id,
        "staff.assign",
        String(eventId),
        undefined,
        { userId },
      );
      return user;
    });
  }
  async staffOptions(actor: { id: string; role: string }): Promise<unknown> {
    this.checkRole(actor);
    return {
      items: (
        await this.db.query(
          "SELECT id,name,email FROM users WHERE role='staff' AND active=true ORDER BY id",
        )
      ).rows,
    };
  }
  async removeStaff(
    actor: { id: string; role: string },
    eventId: number,
    userId: string,
  ): Promise<unknown> {
    this.checkRole(actor);
    return this.db.tx(async (client) => {
      await eventPermission(client, actor, eventId);
      await client.query(
        "DELETE FROM staff_assignments WHERE event_id=$1 AND user_id=$2",
        [eventId, userId],
      );
      await audit(
        client,
        actor.id,
        "staff.remove",
        String(eventId),
        undefined,
        { userId },
      );
      return { eventId, userId, assigned: false };
    });
  }
  async updateGate(
    actor: { id: string; role: string },
    id: number,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    this.checkRole(actor);
    return this.db.tx(async (client) => {
      const gate = (
        await client.query("SELECT * FROM gates WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      if (!gate)
        throw new ConflictException({
          code: "INVALID_GATE",
          message: "Gate not found",
        });
      await eventPermission(client, actor, gate.event_id);
      const name =
        body.name === undefined ? gate.name : stringValue(body.name, "name");
      const zoneId =
        body.zoneId === undefined
          ? gate.zone_id
          : body.zoneId === null
            ? null
            : integer(body.zoneId, "zoneId");
      if (
        zoneId !== null &&
        !(
          await client.query(
            "SELECT id FROM zones WHERE id=$1 AND event_id=$2",
            [zoneId, gate.event_id],
          )
        ).rowCount
      )
        throw new ConflictException({
          code: "INVALID_ZONE",
          message: "Zone does not belong to event",
        });
      if (
        zoneId !== gate.zone_id &&
        (
          await client.query(
            "SELECT id FROM scanner_devices WHERE gate_id=$1 AND revoked_at IS NULL",
            [id],
          )
        ).rowCount
      )
        throw new ConflictException({
          code: "GATE_ACTIVE",
          message:
            "Create a new gate to change zones while registered devices retain this gate",
        });
      await client.query("UPDATE gates SET name=$2,zone_id=$3 WHERE id=$1", [
        id,
        name,
        zoneId,
      ]);
      await audit(client, actor.id, "gate.update", String(id));
      this.events.invalidate(gate.event_id);
      return { id, name, zoneIds: zoneId === null ? [] : [zoneId] };
    });
  }
  async updatePhase(
    actor: { id: string; role: string },
    id: number,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    this.checkRole(actor);
    return this.db.tx(async (client) => {
      const phase = (
        await client.query(
          "SELECT p.*,z.event_id FROM price_phases p JOIN zones z ON z.id=p.zone_id WHERE p.id=$1",
          [id],
        )
      ).rows[0];
      if (!phase)
        throw new ConflictException({
          code: "INVALID_PHASE",
          message: "Phase not found",
        });
      await eventPermission(client, actor, phase.event_id);
      await client.query("SELECT id FROM zones WHERE id=$1 FOR UPDATE", [
        phase.zone_id,
      ]);
      const name =
        body.name === undefined ? phase.name : stringValue(body.name, "name");
      const priceCents =
        body.priceCents === undefined
          ? phase.price_cents
          : integer(body.priceCents, "priceCents", 0, 10000000);
      const startsAt =
        body.startsAt === undefined
          ? new Date(phase.starts_at).toISOString()
          : dateValue(body.startsAt, "startsAt");
      const endsAt =
        body.endsAt === undefined
          ? new Date(phase.ends_at).toISOString()
          : dateValue(body.endsAt, "endsAt");
      if (Date.parse(endsAt) <= Date.parse(startsAt))
        throw new ConflictException({
          code: "INVALID_DATES",
          message: "Phase end must follow start",
        });
      if (
        (
          await client.query(
            "SELECT id FROM price_phases WHERE zone_id=$1 AND id<>$2 AND starts_at<$4 AND ends_at>$3",
            [phase.zone_id, id, startsAt, endsAt],
          )
        ).rowCount
      )
        throw new ConflictException({
          code: "PRICE_OVERLAP",
          message: "Price phases cannot overlap",
        });
      await client.query(
        "UPDATE price_phases SET name=$2,price_cents=$3,starts_at=$4,ends_at=$5 WHERE id=$1",
        [id, name, priceCents, startsAt, endsAt],
      );
      await audit(client, actor.id, "phase.update", String(id));
      this.events.invalidate(phase.event_id);
      return { id, zoneId: phase.zone_id, name, priceCents, startsAt, endsAt };
    });
  }
  async organizers(actor: { id: string; role: string }): Promise<unknown> {
    this.checkRole(actor);
    return {
      items: (
        await this.db.query(
          "SELECT id,name,email FROM users WHERE role='organizador' AND ($1='admin' OR id=$2) ORDER BY id",
          [actor.role, actor.id],
        )
      ).rows,
    };
  }
  async detail(
    actor: { id: string; role: string },
    id: number,
  ): Promise<unknown> {
    this.checkRole(actor);
    await eventPermission(this.db, actor, id);
    const result = await this.events.detail(id, true);
    const staff = (
      await this.db.query(
        "SELECT u.id,u.name,u.email FROM staff_assignments s JOIN users u ON u.id=s.user_id WHERE s.event_id=$1 ORDER BY u.id",
        [id],
      )
    ).rows;
    return { ...result, staff };
  }
  async sales(
    actor: { id: string; role: string },
    id: number,
  ): Promise<unknown> {
    this.checkRole(actor);
    await eventPermission(this.db, actor, id);
    const event = await this.events.detail(id, true);
    const revenue = (
      await this.db.query(
        "SELECT (COALESCE((SELECT SUM(CASE WHEN reservation_id IS NULL AND state='refunded' THEN 0 ELSE amount_cents END) FROM purchases WHERE event_id=$1),0)-COALESCE((SELECT SUM(l.amount_cents) FROM payment_ledger l JOIN tickets t ON t.id=l.ticket_id WHERE t.event_id=$1 AND l.kind='refund'),0))::bigint AS total",
        [id],
      )
    ).rows[0];
    return {
      zones: event.zones,
      revenueCents: Number(revenue.total),
      sold: event.zones.reduce((n: number, z: any) => n + z.sold, 0),
      reserved: event.zones.reduce((n: number, z: any) => n + z.reserved, 0),
      available: event.zones.reduce((n: number, z: any) => n + z.available, 0),
    };
  }
  async tickets(
    actor: { id: string; role: string },
    eventId?: number,
    q?: string,
    cursor?: string,
  ): Promise<unknown> {
    this.checkRole(actor);
    if (eventId) await eventPermission(this.db, actor, eventId);
    const result = await this.db.query(
      'SELECT t.id,t.event_id AS "eventId",e.name AS "eventName",t.zone_id AS "zoneId",z.name AS "zoneName",t.state,t.version,t.holder_id AS "holderId",u.email AS "holderEmail",u.name AS "holderName",b.email AS "buyerEmail",t.issued_at AS "issuedAt",p.unit_price_cents AS "amountCents" FROM tickets t JOIN events e ON e.id=t.event_id JOIN zones z ON z.id=t.zone_id JOIN users u ON u.id=t.holder_id JOIN users b ON b.id=t.buyer_id JOIN purchases p ON p.id=t.purchase_id WHERE ($1::int IS NULL OR t.event_id=$1) AND ($2=\'admin\' OR e.organizer_id=$3) AND ($4::text IS NULL OR u.email ILIKE $4 OR u.name ILIKE $4 OR b.email ILIKE $4 OR t.id ILIKE $4) AND ($5::text IS NULL OR t.id>$5) ORDER BY t.id LIMIT 51',
      [
        eventId ?? null,
        actor.role,
        actor.id,
        q ? `%${q.slice(0, 100)}%` : null,
        cursor ?? null,
      ],
    );
    const items = result.rows.slice(0, 50);
    return {
      items,
      nextCursor: result.rows.length > 50 ? items[items.length - 1]?.id : null,
    };
  }
  async auditLog(
    actor: { id: string; role: string },
    cursor?: string,
    eventId?: number,
  ): Promise<unknown> {
    this.checkRole(actor);
    if (eventId) await eventPermission(this.db, actor, eventId);
    const result = await this.db.query(
      'SELECT a.id,a.actor_id AS "actorId",a.event_id AS "eventId",a.action,a.resource,a.reason,a.details,a.created_at AS "createdAt" FROM audit_log a LEFT JOIN events e ON e.id=a.event_id WHERE ($1::bigint IS NULL OR a.id<$1) AND ($2=\'admin\' OR e.organizer_id=$3) AND ($4::int IS NULL OR a.event_id=$4) ORDER BY a.id DESC LIMIT 51',
      [
        cursor && /^\d+$/.test(cursor) ? cursor : null,
        actor.role,
        actor.id,
        eventId ?? null,
      ],
    );
    const items = result.rows.slice(0, 50);
    return {
      items,
      nextCursor:
        result.rows.length > 50 ? String(items[items.length - 1]?.id) : null,
    };
  }
  async insights(
    actor: { id: string; role: string },
    eventId: number,
    kind: "access" | "devices" | "incidents",
    cursor?: string,
  ): Promise<unknown> {
    this.checkRole(actor);
    await eventPermission(this.db, actor, eventId);
    if (kind === "devices") {
      const result = await this.db.query(
        'SELECT id,owner_id AS "ownerId",event_id AS "eventId",gate_id AS "gateId",name,last_sync_at AS "lastSyncAt",registered_at AS "registeredAt",revocation_cursor AS "revocationCursor" FROM scanner_devices WHERE event_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 101',
        [eventId, cursor ?? null],
      );
      const items = result.rows.slice(0, 100);
      return {
        items,
        nextCursor:
          result.rows.length > 100 ? items[items.length - 1]?.id : null,
      };
    }
    if (kind === "incidents") {
      const result = await this.db.query(
        'SELECT id,type,severity,details,created_at AS "createdAt",device_id AS "deviceId",client_scan_id AS "clientScanId" FROM scanner_incidents WHERE event_id=$1 AND ($2::bigint IS NULL OR id<$2) ORDER BY id DESC LIMIT 51',
        [eventId, cursor && /^\d+$/.test(cursor) ? cursor : null],
      );
      const items = result.rows.slice(0, 50);
      return {
        items,
        nextCursor:
          result.rows.length > 50 ? String(items[items.length - 1]?.id) : null,
      };
    }
    const total = (
      await this.db.query(
        "SELECT COUNT(*)::int AS count FROM scanner_admissions WHERE event_id=$1",
        [eventId],
      )
    ).rows[0].count;
    const byGate = (
      await this.db.query(
        'SELECT g.id AS "gateId",g.name,COUNT(a.ticket_id)::int AS count FROM gates g LEFT JOIN scanner_admissions a ON a.gate_id=g.id WHERE g.event_id=$1 GROUP BY g.id ORDER BY g.id',
        [eventId],
      )
    ).rows;
    const byHour = (
      await this.db.query(
        "SELECT date_trunc('hour',admitted_at) AS hour,COUNT(*)::int AS count FROM scanner_admissions WHERE event_id=$1 GROUP BY 1 ORDER BY 1",
        [eventId],
      )
    ).rows;
    return { totalAdmissions: total, byGate, byHour };
  }
  refund(
    actor: { id: string; role: string },
    id: string,
    key: unknown,
    body: Record<string, unknown>,
    voidOnly: boolean,
  ): Promise<unknown> {
    this.checkRole(actor);
    return this.commerce.refund(actor, id, key, body.reason, true, voidOnly);
  }
}
@Controller("v1/admin")
@UseGuards(AuthGuard)
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}
  @Get("events") list(
    @Req() req: AuthenticatedRequest,
    @Query("cursor") cursor?: string,
  ): Promise<unknown> {
    return this.admin.list(req.user, cursor);
  }
  @Post("events") create(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.admin.create(req.user, body);
  }
  @Get("events/:id") detail(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<unknown> {
    return this.admin.detail(req.user, Number(id));
  }
  @Patch("events/:id") update(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.admin.update(req.user, Number(id), body);
  }
  @Post("events/:id/zones") zone(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.admin.zone(req.user, Number(id), body);
  }
  @Patch("zones/:id") updateZone(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.admin.updateZone(req.user, Number(id), body);
  }
  @Post("events/:id/phases") phase(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.admin.phase(req.user, Number(id), body);
  }
  @Post("events/:id/gates") gate(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.admin.gate(req.user, Number(id), body);
  }
  @Post("events/:id/staff") staff(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.admin.staff(req.user, Number(id), body);
  }
  @Delete("events/:id/staff/:userId") removeStaff(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("userId") userId: string,
  ): Promise<unknown> {
    return this.admin.removeStaff(req.user, Number(id), userId);
  }
  @Patch("gates/:id") updateGate(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.admin.updateGate(req.user, Number(id), body);
  }
  @Patch("phases/:id") updatePhase(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.admin.updatePhase(req.user, Number(id), body);
  }
  @Get("staff") staffOptions(
    @Req() req: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.admin.staffOptions(req.user);
  }
  @Get("organizers") organizers(
    @Req() req: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.admin.organizers(req.user);
  }
  @Get("events/:id/sales") sales(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<unknown> {
    return this.admin.sales(req.user, Number(id));
  }
  @Get("tickets") tickets(
    @Req() req: AuthenticatedRequest,
    @Query("eventId") eventId?: string,
    @Query("q") q?: string,
    @Query("cursor") cursor?: string,
  ): Promise<unknown> {
    return this.admin.tickets(
      req.user,
      eventId ? Number(eventId) : undefined,
      q,
      cursor,
    );
  }
  @Post("tickets/:id/refund") refund(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: unknown,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.admin.refund(req.user, id, key, body, false);
  }
  @Post("tickets/:id/void") voidTicket(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: unknown,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.admin.refund(req.user, id, key, body, true);
  }
  @Get("audit") audit(
    @Req() req: AuthenticatedRequest,
    @Query("cursor") cursor?: string,
    @Query("eventId") eventId?: string,
  ): Promise<unknown> {
    return this.admin.auditLog(
      req.user,
      cursor,
      eventId ? Number(eventId) : undefined,
    );
  }
  @Get("events/:id/access") access(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<unknown> {
    return this.admin.insights(req.user, Number(id), "access");
  }
  @Get("events/:id/devices") devices(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Query("cursor") cursor?: string,
  ): Promise<unknown> {
    return this.admin.insights(req.user, Number(id), "devices", cursor);
  }
  @Get("events/:id/incidents") incidents(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Query("cursor") cursor?: string,
  ): Promise<unknown> {
    return this.admin.insights(req.user, Number(id), "incidents", cursor);
  }
}
@Module({
  imports: [CommerceModule, EventsModule],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
