export type Role = 'asistente' | 'staff' | 'organizador' | 'admin';
export interface User { id: string; email: string; name: string; role: Role }
export interface Session { accessToken: string; refreshToken: string; user: User }

const baseUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const sessionKey = 'hypernova.admin.session';
let currentSession: Session | null = null;
let refreshFlight: { token: string; promise: Promise<Session> } | null = null;

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string, public readonly correlationId?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export function session(): Session | null {
  if (currentSession) return currentSession;
  try {
    const stored = sessionStorage.getItem(sessionKey);
    if (!stored) return null;
    const value: unknown = JSON.parse(stored);
    if (typeof value !== 'object' || !value || !('accessToken' in value) || !('refreshToken' in value) || !('user' in value)) return null;
    const candidate = value as Session;
    if (typeof candidate.accessToken !== 'string' || typeof candidate.refreshToken !== 'string' || !candidate.user || typeof candidate.user.id !== 'string' || typeof candidate.user.email !== 'string' || typeof candidate.user.name !== 'string' || !['asistente', 'staff', 'organizador', 'admin'].includes(candidate.user.role)) return null;
    currentSession = candidate;
    return candidate;
  } catch { return null; }
}

export function saveSession(value: Session | null): void {
  currentSession = value;
  try {
    if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value));
    else sessionStorage.removeItem(sessionKey);
  } catch { /* A blocked browser storage still permits an in-memory session. */ }
}

const errorMessages: Record<string, string> = {
  AUTH_INVALID_CREDENTIALS: 'El correo o la contraseña son incorrectos.',
  AUTH_INVALID_REFRESH: 'La sesión expiró. Ingresa nuevamente.',
  AUTH_INVALID_TOKEN: 'La sesión no es válida. Ingresa nuevamente.',
  AUTH_RATE_LIMITED: 'Demasiados intentos. Espera un momento y vuelve a intentar.',
  ADMIN_FORBIDDEN: 'Tu cuenta no tiene permisos para administrar eventos.',
  EVENT_FORBIDDEN: 'No tienes permiso para administrar este evento.',
  TICKET_FORBIDDEN: 'No tienes permiso para modificar esta entrada.',
  TICKET_USED: 'La entrada ya fue usada. No se puede reembolsar ni anular.',
  REFUND_CLOSED: 'El plazo de reembolso de este evento ya terminó.',
  CAPACITY_CONFLICT: 'El aforo no puede ser menor a las entradas vendidas y las reservas vigentes.',
  PRICE_OVERLAP: 'Las fechas de esta fase se superponen con otra fase de la misma zona.',
  INVALID_DATES: 'Revisa las fechas: la venta y los reembolsos deben terminar antes del evento, y cada fase debe tener un inicio anterior a su fin.',
  INVALID_ORGANIZER: 'Selecciona una cuenta válida con rol organizador.',
  INVALID_STAFF: 'Selecciona una cuenta activa con rol staff.',
  INVALID_ZONE: 'La zona no existe o no pertenece al evento.',
  INVALID_GATE: 'La puerta seleccionada no existe.',
  INVALID_PHASE: 'La fase seleccionada no existe.',
  INVALID_STATUS: 'El estado del evento no es válido.',
  GATE_ACTIVE: 'Esta puerta tiene dispositivos registrados. Su zona no puede cambiar durante la operación.',
  IDEMPOTENCY_CONFLICT: 'Esta operación ya se registró con datos diferentes. Revisa el estado antes de volver a intentar.',
  NOT_FOUND: 'El recurso solicitado ya no está disponible.',
  PURCHASE_RATE_LIMIT: 'Se alcanzó el límite de operaciones. Espera un momento y vuelve a intentar.',
};

async function readResponse<T>(response: Response): Promise<T> {
  const data: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    const nested = error.error && typeof error.error === 'object' ? error.error as Record<string, unknown> : error;
    const message = Array.isArray(nested.message) ? nested.message.join(' · ') : typeof nested.message === 'string' ? nested.message : 'No se pudo completar la operación.';
    const code = typeof nested.code === 'string' ? nested.code : `HTTP_${response.status}`;
    throw new ApiError(errorMessages[code] ?? message, response.status, code, typeof error.correlationId === 'string' ? error.correlationId : response.headers.get('x-correlation-id') ?? undefined);
  }
  return data as T;
}

async function refreshSession(): Promise<Session> {
  const existing = session();
  if (!existing) throw new ApiError('La sesión expiró. Inicia sesión nuevamente.', 401, 'SESSION_EXPIRED');
  try {
    const response = await fetch(`${baseUrl}/v1/auth/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: existing.refreshToken }),
    });
    const fresh = await readResponse<Session>(response);
    const latest = session();
    if (latest?.refreshToken !== existing.refreshToken) {
      if (latest) return latest;
      throw new ApiError('La sesión cambió. Ingresa nuevamente.', 401, 'SESSION_CHANGED');
    }
    saveSession(fresh);
    return fresh;
  } catch (error) {
    if (error instanceof ApiError && [401, 403].includes(error.status) && session()?.refreshToken === existing.refreshToken) {
      saveSession(null);
      window.dispatchEvent(new Event('hypernova:session-expired'));
    }
    if (!(error instanceof ApiError)) throw new ApiError('No se pudo renovar la sesión por un problema de conexión. Vuelve a intentar.', 0, 'NETWORK_ERROR');
    throw error;
  }
}

export async function api<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const authorization = session()?.accessToken;
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (authorization) headers.set('Authorization', `Bearer ${authorization}`);
  let response: Response;
  try { response = await fetch(`${baseUrl}/v1${path}`, { ...options, headers }); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('No hay conexión con el servidor. Comprueba que el backend está disponible y vuelve a intentar.', 0, 'NETWORK_ERROR');
  }
  if (response.status === 401 && authorization && retry && !path.startsWith('/auth/')) {
    if (session()?.accessToken === authorization) {
      const token = session()!.refreshToken;
      if (!refreshFlight || refreshFlight.token !== token) {
        const flight = { token, promise: refreshSession() };
        refreshFlight = flight;
        void flight.promise.finally(() => { if (refreshFlight === flight) refreshFlight = null; }).catch(() => {});
      }
      await refreshFlight.promise;
    }
    return api<T>(path, options, false);
  }
  return readResponse<T>(response);
}

export async function login(email: string, password: string): Promise<Session> {
  const value = await api<Session>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (value.user.role !== 'organizador' && value.user.role !== 'admin') {
    await fetch(`${baseUrl}/v1/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${value.accessToken}` }, body: JSON.stringify({ refreshToken: value.refreshToken }) });
    throw new ApiError('Esta cuenta no tiene acceso al portal. Ingresa con una cuenta de organizador o administrador.', 403, 'ROLE_FORBIDDEN');
  }
  saveSession(value);
  return value;
}

export async function logout(): Promise<void> {
  const active = session();
  if (!active) return;
  await api('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: active.refreshToken }) }, false);
  saveSession(null);
}

export const mutate = <T>(path: string, body: unknown, method = 'POST', idempotent = false): Promise<T> => api<T>(path, {
  method, body: JSON.stringify(body), headers: idempotent ? { 'Idempotency-Key': crypto.randomUUID() } : {},
});
export function describeError(error: unknown): string { return error instanceof Error ? error.message : 'Ocurrió un error inesperado.'; }
