import {
  Inject,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import { Db } from "./db";

@Injectable()
export class EventsService {
  private readonly cache = new Map<number, { until: number; value: any }>();
  private readonly inflight = new Map<number, Promise<any>>();
  constructor(@Inject(Db) private readonly db: Db) {}
  async detail(id: number, fresh = false): Promise<any> {
    if (fresh) return this.readDetail(id);
    const cached = this.cache.get(id);
    if (cached && cached.until > Date.now()) return cached.value;
    const running = this.inflight.get(id);
    if (running) return running;
    const work = this.readDetail(id)
      .then((value) => {
        this.cache.set(id, { until: Date.now() + 500, value });
        if (this.cache.size > 2000)
          for (const [key, entry] of this.cache)
            if (entry.until < Date.now()) this.cache.delete(key);
        return value;
      })
      .finally(() => this.inflight.delete(id));
    this.inflight.set(id, work);
    return work;
  }
  invalidate(id: number): void {
    this.cache.delete(id);
  }
  private async readDetail(id: number): Promise<any> {
    const event = (
      await this.db.query(
        'SELECT id,name,organizer_id AS "organizerId",starts_at AS "startsAt",sale_opens_at AS "saleOpensAt",refund_until AS "refundUntil",per_account_limit AS "perAccountLimit",status,venue FROM events WHERE id=$1',
        [id],
      )
    ).rows[0];
    if (!event)
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Event not found",
      });
    const zones = await this.db.query(
      "SELECT z.id,z.name,z.capacity,z.sold_count AS sold,COALESCE(r.quantity,0)::int AS reserved,(z.capacity-z.sold_count-COALESCE(r.quantity,0))::int AS available,p.price_cents AS \"priceCents\" FROM zones z LEFT JOIN LATERAL(SELECT SUM(quantity) AS quantity FROM reservations WHERE zone_id=z.id AND state='active' AND expires_at>now()) r ON true LEFT JOIN LATERAL(SELECT price_cents FROM price_phases WHERE zone_id=z.id AND starts_at<=now() AND ends_at>now() ORDER BY starts_at DESC,id DESC LIMIT 1)p ON true WHERE z.event_id=$1 ORDER BY z.id",
      [id],
    );
    const gates = await this.db.query(
      "SELECT id,name,CASE WHEN zone_id IS NULL THEN '[]'::json ELSE json_build_array(zone_id) END AS \"zoneIds\" FROM gates WHERE event_id=$1 ORDER BY id",
      [id],
    );
    const phases = await this.db.query(
      'SELECT p.id,p.zone_id AS "zoneId",p.name,p.price_cents AS "priceCents",p.starts_at AS "startsAt",p.ends_at AS "endsAt" FROM price_phases p JOIN zones z ON z.id=p.zone_id WHERE z.event_id=$1 ORDER BY p.starts_at,p.id',
      [id],
    );
    return {
      ...event,
      zones: zones.rows,
      gates: gates.rows,
      phases: phases.rows,
    };
  }
  async list(
    cursor?: string,
    organizerId?: string,
    fresh = false,
  ): Promise<any> {
    const events = await this.db.query(
      "SELECT id FROM events WHERE ($1::int IS NULL OR id>$1) AND ($2::text IS NULL OR organizer_id=$2) ORDER BY id LIMIT 21",
      [
        cursor && /^\d+$/.test(cursor) ? Number(cursor) : null,
        organizerId ?? null,
      ],
    );
    const items = await Promise.all(
      events.rows.slice(0, 20).map((row) => this.detail(row.id, fresh)),
    );
    return {
      items,
      nextCursor:
        events.rows.length > 20 ? String(items[items.length - 1]?.id) : null,
    };
  }
}
@Controller("v1/events")
export class EventsController {
  constructor(@Inject(EventsService) private readonly events: EventsService) {}
  @Get() list(@Query("cursor") cursor?: string): Promise<any> {
    return this.events.list(cursor);
  }
  @Get(":id") detail(@Param("id") id: string): Promise<any> {
    return this.events.detail(Number(id));
  }
}
@Module({
  providers: [EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class EventsModule {}
