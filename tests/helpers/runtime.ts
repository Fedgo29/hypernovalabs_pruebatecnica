import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { publicKeyFromSeed, signRotatingCode, type AuthResponse, type SignedCredential } from '@hypernova/contracts';

export const baseUrl = (process.env.API_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? '3000'}`).replace(/\/$/, '');
export const runId = `qa-${Date.now()}-${randomUUID().slice(0, 8)}`;
export interface ApiResult<T = any> { status: number; body: T; durationMs: number; correlationId: string | null }
export async function request<T = any>(path: string, options: { session?: AuthResponse; method?: string; body?: unknown; key?: string } = {}): Promise<ApiResult<T>> {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.session ? { authorization: `Bearer ${options.session.accessToken}` } : {}),
      ...(options.key ? { 'idempotency-key': options.key } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(60000),
  });
  const body = await response.json();
  return { status: response.status, body, durationMs: performance.now() - started, correlationId: response.headers.get('x-correlation-id') };
}
export function ok<T>(result: ApiResult<T>): T {
  assert.ok(result.status >= 200 && result.status < 300, `HTTP ${result.status}; code=${(result.body as any)?.error?.code ?? 'unknown'}`);
  return result.body;
}
export function failure(result: ApiResult, status: number, code?: string): void {
  assert.equal(result.status, status, `HTTP ${result.status}; code=${result.body?.error?.code ?? 'unknown'}`);
  assert.equal(typeof result.body?.error?.code, 'string');
  assert.ok(result.correlationId, 'error must have a correlation identifier');
  if (code) assert.equal(result.body.error.code, code);
}
export function sql(query: string): string {
  return execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'hypernova_owner', '-d', 'hypernova', '-At', '-c', query], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
export const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
let password: string | undefined;
export function demoPassword(): string {
  if (!password) password = process.env.DEMO_PASSWORD ?? JSON.parse(execFileSync('docker', ['compose', 'exec', '-T', 'api', 'cat', '/app/runtime/demo-credentials.json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).password;
  assert.equal(typeof password, 'string');
  return password!;
}
export async function login(email: string): Promise<AuthResponse> {
  return ok(await request<AuthResponse>('/v1/auth/login', { body: { email, password: demoPassword() } }));
}
export async function roleSessions(): Promise<{admin: AuthResponse; organizer: AuthResponse; otherOrganizer: AuthResponse; staff: AuthResponse; attendees: AuthResponse[]}> {
  const admin = await login('admin.101@example.test');
  const organizer = await login('organizador.201@example.test');
  const otherOrganizer = await login('organizador.202@example.test');
  const staff = await login('staff.301@example.test');
  const emails = sql("SELECT email FROM users WHERE role='asistente' AND active=true AND id ~ '^asistente-[0-9]+$' ORDER BY id DESC LIMIT 6").split('\n');
  const attendees = [];
  for (const email of emails) attendees.push(await login(email));
  return { admin, organizer, otherOrganizer, staff, attendees };
}
export const createdEventIds: number[] = [];
export interface Fixture { eventId: number; zoneIds: number[]; gateIds: number[] }
export async function createFixture(admin: AuthResponse, organizerId: string, options: {capacity?: number; limit?: number; zones?: number; label?: string} = {}): Promise<Fixture> {
  const now = Date.now();
  const event = ok(await request('/v1/admin/events', { session: admin, body: { name: `${runId}-${options.label ?? 'fixture'}`, organizerId, startsAt: new Date(now + 7 * 86400000).toISOString(), saleOpensAt: new Date(now - 86400000).toISOString(), refundUntil: new Date(now + 6 * 86400000).toISOString(), perAccountLimit: options.limit ?? 20, status: 'en_venta' } }));
  createdEventIds.push(event.id);
  const zoneIds = [], gateIds = [];
  for (let i = 0; i < (options.zones ?? 1); i++) {
    const zone = ok(await request(`/v1/admin/events/${event.id}/zones`, { session: admin, body: { name: `Zona ${i + 1}`, capacity: options.capacity ?? 100 } }));
    zoneIds.push(zone.id);
    ok(await request(`/v1/admin/events/${event.id}/phases`, { session: admin, body: { zoneId: zone.id, name: 'General', priceCents: 12345, startsAt: new Date(now - 86400000).toISOString(), endsAt: new Date(now + 7 * 86400000).toISOString() } }));
    const gate = ok(await request(`/v1/admin/events/${event.id}/gates`, { session: admin, body: { name: `Puerta ${i + 1}`, zoneId: zone.id } }));
    gateIds.push(gate.id);
  }
  return { eventId: event.id, zoneIds, gateIds };
}
export async function reserve(attendee: AuthResponse, zoneId: number, quantity = 1, key = randomUUID()): Promise<any> {
  return ok(await request('/v1/reservations', { session: attendee, key, body: { zoneId, quantity } }));
}
export async function buy(attendee: AuthResponse, zoneId: number): Promise<any> {
  const reservation = await reserve(attendee, zoneId);
  return ok(await request(`/v1/reservations/${reservation.id}/pay`, { session: attendee, key: randomUUID(), method: 'POST' }));
}
export interface Material { credential: SignedCredential; issuerPublicKey: string; keyId: string; slotSeconds: number }
export async function material(attendee: AuthResponse, ticketId: string): Promise<{ seed: string; material: Material; token: string }> {
  const seed = randomBytes(32).toString('hex');
  const value = ok(await request<Material>(`/v1/tickets/${ticketId}/credential`, { session: attendee, body: { holderPublicKey: publicKeyFromSeed(seed) } }));
  return { seed, material: value, token: signRotatingCode(value.credential, seed, Date.now() / 1000) };
}
export async function scanner(admin: AuthResponse, staff: AuthResponse, fixture: Fixture, gateId: number) {
  ok(await request(`/v1/admin/events/${fixture.eventId}/staff`, { session: admin, body: { userId: staff.user.id } }));
  const deviceId = randomUUID();
  ok(await request('/v1/scanner/devices', { session: staff, body: { deviceId, eventId: fixture.eventId, gateId, name: `${runId}-scanner` } }));
  const bootstrap = ok(await request(`/v1/scanner/bootstrap?deviceId=${deviceId}`, { session: staff }));
  const shift = ok(await request('/v1/scanner/shifts', { session: staff, body: { deviceId } }));
  return { deviceId, shiftId: shift.id, gateId, bootstrap };
}
export function scanAttempt(scan: Awaited<ReturnType<typeof scanner>>, fixture: Fixture, ticket: any, token: string) {
  return { clientScanId: randomUUID(), ticketId: ticket.id, eventId: fixture.eventId, gateId: scan.gateId, credentialVersion: ticket.version, scannedAt: new Date().toISOString(), localResult: 'valid', token, revocationCursor: scan.bootstrap.revocationCursor, bootstrapAt: scan.bootstrap.serverTime };
}
export async function sync(staff: AuthResponse, scan: Awaited<ReturnType<typeof scanner>>, attempts: any[]) {
  return ok(await request('/v1/scanner/scans', { session: staff, body: { deviceId: scan.deviceId, shiftId: scan.shiftId, scans: attempts } }));
}
