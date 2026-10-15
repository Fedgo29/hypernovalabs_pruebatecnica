import * as SecureStore from 'expo-secure-store';
import type { AuthResponse, User } from '@hypernova/contracts';

const configuredUrl = process.env.EXPO_PUBLIC_API_URL;
export const API_URL = configuredUrl?.replace(/\/$/, '') ?? '';
let current: AuthResponse | null = null;
let refreshInFlight: Promise<void> | null = null;
let persistenceQueue: Promise<void> = Promise.resolve();
let expiredCallback: (() => void) | undefined;

export class ApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) { super(message); }
}
export function onSessionExpired(callback: () => void): void { expiredCallback = callback; }
export async function restoreSession(): Promise<AuthResponse | null> {
  const [accessToken, refreshToken, userJson] = await Promise.all([
    SecureStore.getItemAsync('hn-access'), SecureStore.getItemAsync('hn-refresh'), SecureStore.getItemAsync('hn-user'),
  ]);
  if (!accessToken || !refreshToken || !userJson) return null;
  try { current = { accessToken, refreshToken, user: JSON.parse(userJson) as User }; return current; }
  catch { await clearSession(); return null; }
}
export async function saveSession(session: AuthResponse): Promise<void> {
  current = session;
  persistenceQueue = persistenceQueue.catch(() => undefined).then(async () => {
    await Promise.all([
      SecureStore.setItemAsync('hn-access', session.accessToken),
      SecureStore.setItemAsync('hn-refresh', session.refreshToken),
      SecureStore.setItemAsync('hn-user', JSON.stringify(session.user)),
    ]);
  });
  await persistenceQueue;
}
export async function clearSession(): Promise<void> {
  current = null;
  persistenceQueue = persistenceQueue.catch(() => undefined).then(async () => {
    await Promise.all(['hn-access', 'hn-refresh', 'hn-user'].map((key) => SecureStore.deleteItemAsync(key)));
  });
  await persistenceQueue;
}
async function fetchRequest(path: string, init: RequestInit, token?: string): Promise<Response> {
  if (!API_URL) throw new ApiError('Define EXPO_PUBLIC_API_URL antes de iniciar Expo.', 'API_URL_MISSING', 0);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(`${API_URL}${path}`, {
      ...init, signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new ApiError('No se pudo conectar. Comprueba la red y vuelve a intentar.', 'NETWORK_ERROR', 0);
  } finally { clearTimeout(timer); }
}
async function refreshSession(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    if (!current) throw new ApiError('Inicia sesión nuevamente.', 'SESSION_EXPIRED', 401);
    const original = current;
    const response = await fetchRequest('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: original.refreshToken }) });
    if (!response.ok) {
      if (response.status === 401 && current === original) { await clearSession(); expiredCallback?.(); }
      throw new ApiError('No se pudo renovar la sesión.', 'SESSION_EXPIRED', response.status);
    }
    const renewed = await response.json() as AuthResponse;
    if (current === original) await saveSession(renewed);
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}
export async function api<T>(path: string, method = 'GET', body?: unknown, idempotencyKey?: string, anonymous = false): Promise<T> {
  const init: RequestInit = { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} };
  const tokenUsed = anonymous ? undefined : current?.accessToken;
  const accountUsed = current?.user.id;
  let response = await fetchRequest(path, init, tokenUsed);
  if (response.status === 401 && !anonymous && current) {
    // A delayed 401 for an old token must not rotate an already-renewed session again.
    if (current.accessToken === tokenUsed) await refreshSession();
    if (current?.user.id !== accountUsed) throw new ApiError('La sesión cambió. Vuelve a abrir esta pantalla.', 'SESSION_CHANGED', 401);
    response = await fetchRequest(path, init, current?.accessToken);
  }
  const text = await response.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
  if (!response.ok) {
    const error = data as { code?: string; message?: string | string[]; error?: { code?: string; message?: string } } | undefined;
    const message = error?.error?.message ?? error?.message;
    throw new ApiError(Array.isArray(message) ? message.join(', ') : message ?? `Error HTTP ${response.status}`, error?.error?.code ?? error?.code ?? 'REQUEST_FAILED', response.status);
  }
  return data as T;
}
export async function login(email: string, password: string, name?: string): Promise<AuthResponse> {
  const session = await api<AuthResponse>(name === undefined ? '/auth/login' : '/auth/register', 'POST',
    { email, password, ...(name === undefined ? {} : { name }) }, undefined, true);
  await saveSession(session);
  return session;
}
export async function logout(): Promise<void> {
  if (current) await api('/auth/logout', 'POST', { refreshToken: current.refreshToken }, undefined, true);
  await clearSession();
}
