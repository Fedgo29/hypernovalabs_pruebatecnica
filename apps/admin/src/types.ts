export interface Zone { id: number; name: string; capacity: number; sold: number; reserved: number; available: number; priceCents?: number | null }
export interface PricePhase { id: number; zoneId: number; name: string; priceCents: number; startsAt: string; endsAt: string }
export interface Gate { id: number; name: string; zoneId?: number | null; zoneIds?: number[] }
export interface StaffMember { id: string; name: string; email: string }
export interface EventInfo { id: number; name: string; code?: string | null; organizerId: string; startsAt: string; saleOpensAt: string; refundUntil: string; perAccountLimit: number; status: string; venue: string; zones: Zone[]; phases?: PricePhase[]; gates?: Gate[]; staff?: StaffMember[] }
export interface Sales { zones: Zone[]; revenueCents: number; refundsCents?: number; sold?: number; reserved?: number; available?: number }
export interface Ticket { id: string; eventId: number; zoneId: number; buyerEmail: string; buyerName?: string; holderEmail?: string; state: string; issuedAt: string; usedAt?: string | null; amountCents?: number; zoneName?: string }
export interface CursorPage<T> { items: T[]; nextCursor?: string | null }
export interface AccessReport { totalAdmissions: number; byGate: { gateId: number; name: string; count: number }[]; byHour: { hour: string; count: number }[] }
export interface Device { id: string; ownerId: string; eventId: number; gateId: number; name: string; lastSyncAt: string | null; registeredAt: string; revocationCursor: string }
export interface Incident { id: string; type: string; severity: string; details: Record<string, unknown>; createdAt: string; deviceId: string | null; clientScanId: string | null }
export interface AuditEntry { id: string; actorId: string | null; actorName?: string; action: string; resource: string; reason: string | null; details: Record<string, unknown>; createdAt: string }
