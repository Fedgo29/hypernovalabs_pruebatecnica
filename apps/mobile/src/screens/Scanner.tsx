import React, { useEffect, useRef, useState } from 'react';
import { AppState, FlatList, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import type { Revocation, User } from '@hypernova/contracts';
import { api } from '../api';
import { acknowledgeScans, getLocal, pendingCount, pendingScans, recentScans, scan, setLocal } from '../storage';
import type { Event, Gate, LocalResult, LocalScan, Page, ScannerBootstrap, ScannerSetup } from '../types';
import { Button, Card, date, Heading, Input, Label, Loading, Message, palette, styles, Subtext } from '../ui';

const labels: Record<LocalResult, string> = { valid: 'Entrada válida', already_used: 'Ya usada en este dispositivo', revoked: 'Entrada revocada', expired: 'Código expirado', wrong_event: 'Evento equivocado', wrong_zone: 'Zona equivocada', invalid_signature: 'Firma inválida' };
export default function Scanner({ user }: { user: User }): React.JSX.Element {
  const [setup, setSetup] = useState<ScannerSetup | null>(null);
  const setupRef = useRef<ScannerSetup | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [event, setEvent] = useState<Event | null>(null);
  const [count, setCount] = useState(0);
  const [recent, setRecent] = useState<LocalScan[]>([]);
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const syncLock = useRef(false);
  const scanLock = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [lastResult, setLastResult] = useState<LocalResult | null>(null);
  const [camera, setCamera] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [clock, setClock] = useState(Date.now());
  function applySetup(value: ScannerSetup): void { setupRef.current = value; setSetup(value); }
  async function counters(current: ScannerSetup): Promise<void> {
    const [pending, rows] = await Promise.all([pendingCount(user.id, current.deviceId), recentScans(user.id, current.deviceId)]);
    setCount(pending); setRecent(rows);
  }
  async function loadEvents(): Promise<void> {
    setBusy(true); setError('');
    try {
      const items: Event[] = []; let cursor: string | null = null;
      do { const page: Page<Event> = await api<Page<Event>>(`/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`); items.push(...page.items); cursor = page.nextCursor; } while (cursor);
      setEvents(items);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron cargar los eventos.'); }
    finally { setBusy(false); }
  }
  async function openEvent(item: Event): Promise<void> {
    setBusy(true); setError('');
    try { setEvent(await api<Event>(`/events/${item.id}`)); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron cargar las puertas.'); }
    finally { setBusy(false); }
  }
  async function startShift(gate: Gate): Promise<void> {
    if (!event) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const localKey = `device:${user.id}:${event.id}:${gate.id}`;
      let deviceId = await getLocal<string>(localKey);
      if (!deviceId) { deviceId = Crypto.randomUUID(); await setLocal(localKey, deviceId); }
      await api('/scanner/devices', 'POST', { deviceId, eventId: event.id, gateId: gate.id, name: 'Expo scanner' });
      const bootstrap = await api<ScannerBootstrap>(`/scanner/bootstrap?deviceId=${encodeURIComponent(deviceId)}`);
      const downloadedAt = Date.now();
      if (bootstrap.serverTime && Math.abs(Date.parse(bootstrap.serverTime) - downloadedAt) > 60000) throw new Error('El reloj del dispositivo está desincronizado. Activa la fecha y hora automáticas antes de iniciar.');
      const shift = await api<{ id: string }>('/scanner/shifts', 'POST', { deviceId });
      const saved: ScannerSetup = { deviceId, shiftId: shift.id, bootstrap, downloadedAt,
        clockOffsetMs: bootstrap.serverTime ? Date.parse(bootstrap.serverTime) - downloadedAt : 0 };
      await setLocal(`scanner:${user.id}`, saved); applySetup(saved); setEvent(null); await counters(saved);
      setMessage('Turno iniciado. Las claves y revocaciones ya están guardadas para escanear sin red.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo iniciar el turno.'); }
    finally { setBusy(false); }
  }
  async function sync(manual = false): Promise<void> {
    const current = setupRef.current;
    if (!current || syncLock.current) return;
    syncLock.current = true; setSyncing(true);
    if (manual) { setError(''); setMessage(''); }
    try {
      let incidents = 0;
      while (true) {
        const rows = await pendingScans(user.id, current.deviceId);
        if (!rows.length) break;
        const groups = new Map<string, LocalScan[]>();
        for (const row of rows) { const id = row.shiftId ?? current.shiftId; groups.set(id, [...(groups.get(id) ?? []), row]); }
        for (const [shiftId, attempts] of groups) {
          const response = await api<{ results: { clientScanId: string; serverResult: string; incidentId?: string }[] }>('/scanner/scans', 'POST',
            { deviceId: current.deviceId, shiftId, scans: attempts.map(({ shiftId: ignored, ...attempt }) => ({ ...attempt, token: attempt.token.trim() ? attempt.token : null })) });
          if (!response.results.length) throw new Error('El servidor no confirmó el lote. Se conserva para reintentar.');
          await acknowledgeScans(response.results); incidents += response.results.filter((result) => !!result.incidentId).length;
        }
      }
      const revoked = new Map(current.bootstrap.revocations.map((item) => [item.ticketId, item]));
      let cursor = current.bootstrap.revocationCursor; let more = false; let serverTime: string | undefined;
      do {
        const delta: { revocations: Revocation[]; revocationCursor: string; hasMore: boolean; serverTime?: string } = await api(`/scanner/revocations?deviceId=${encodeURIComponent(current.deviceId)}&cursor=${encodeURIComponent(cursor)}`);
        for (const item of delta.revocations) if (item.version >= (revoked.get(item.ticketId)?.version ?? 0)) revoked.set(item.ticketId, item);
        cursor = delta.revocationCursor; more = delta.hasMore; serverTime = delta.serverTime;
      } while (more);
      const downloadedAt = Date.now();
      if (serverTime && Math.abs(Date.parse(serverTime) - downloadedAt) > 60000) throw new Error('El reloj del dispositivo cambió. Activa la fecha y hora automáticas para continuar.');
      const updated: ScannerSetup = { ...current, downloadedAt,
        clockOffsetMs: serverTime ? Date.parse(serverTime) - downloadedAt : current.clockOffsetMs,
        bootstrap: { ...current.bootstrap, revocations: [...revoked.values()], revocationCursor: cursor } };
      if (setupRef.current?.deviceId !== current.deviceId || setupRef.current.shiftId !== current.shiftId) return;
      await setLocal(`scanner:${user.id}`, updated); applySetup(updated); await counters(updated);
      if (manual || incidents) setMessage(incidents ? `Sincronización completada. ${incidents} incidente(s) registrado(s) en el portal.` : 'Sincronización completada. Revocaciones actualizadas.');
    } catch (e) { if (manual) setError(e instanceof Error ? e.message : 'No se pudo sincronizar. Los intentos siguen guardados.'); }
    finally { syncLock.current = false; setSyncing(false); }
  }
  useEffect(() => {
    void getLocal<ScannerSetup>(`scanner:${user.id}`).then(async (saved) => { if (saved) { applySetup(saved); await counters(saved); } else await loadEvents(); });
    const timer = setInterval(() => { setClock(Date.now()); void sync(); }, 20000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void sync(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
  async function capture(token: string): Promise<void> {
    const current = setupRef.current;
    if (!current || scanLock.current) return;
    if (Date.now() - current.downloadedAt > (current.bootstrap.maxOfflineHours ?? 72) * 3600000) { setError('La lista de revocación venció. Sincroniza antes de continuar.'); setCamera(false); return; }
    scanLock.current = true; setError('');
    try { const result = await scan(user.id, current, token); setLastResult(result.result); await counters(current); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el intento. No permitas el acceso.'); }
    finally { setTimeout(() => { scanLock.current = false; }, 1500); }
  }
  const header = <><Heading>Control de acceso</Heading><Subtext>La validación y los intentos quedan guardados en este dispositivo.</Subtext><Message text={error} error /><Message text={message} />{busy && <Loading />}</>;
  if (!setup) return <FlatList style={styles.screen} contentContainerStyle={styles.content} data={event ? [] : events} keyExtractor={(item) => String(item.id)} ListHeaderComponent={<>{header}
    {event && <><Button title="← Eventos" secondary onPress={() => setEvent(null)} /><Card><Heading>{event.name}</Heading><Subtext>Selecciona tu puerta. El servidor comprueba tu asignación de staff.</Subtext></Card>
      {!event.gates?.length && <Subtext>El evento aún no tiene puertas.</Subtext>}{event.gates?.map((gate) => <Card key={gate.id}><Label>{gate.name}</Label><Button title="Iniciar turno en esta puerta" onPress={() => void startShift(gate)} disabled={busy} /></Card>)}</>}
  </>} renderItem={({ item }) => <Card><Label>{item.name}</Label><Subtext>{date(item.startsAt)}</Subtext><Button title="Elegir puerta" onPress={() => void openEvent(item)} disabled={busy} /></Card>}
    ListEmptyComponent={!event && !busy ? <Card><Subtext>No hay eventos disponibles.</Subtext><Button title="Actualizar" secondary onPress={() => void loadEvents()} /></Card> : null} initialNumToRender={6} />;
  const expired = clock - setup.downloadedAt > (setup.bootstrap.maxOfflineHours ?? 72) * 3600000;
  return <FlatList style={styles.screen} contentContainerStyle={styles.content} data={recent} keyExtractor={(item) => item.clientScanId} initialNumToRender={5}
    ListHeaderComponent={<>{header}<Card><Label>{setup.bootstrap.event.name}</Label><Subtext>{setup.bootstrap.gate.name} · turno {setup.shiftId.slice(0, 8)}</Subtext><Subtext>Última sincronización: {date(new Date(setup.downloadedAt).toISOString())}</Subtext>
      <Text style={{ color: count ? palette.accent : palette.green, fontSize: 24, fontWeight: '700' }}>{count} pendientes</Text>
      {expired && <Message text="Revocaciones vencidas. Sincroniza para continuar." error />}
      <Button title={syncing ? 'Sincronizando…' : 'Sincronizar ahora'} onPress={() => void sync(true)} disabled={syncing} />
      <Button title="Cambiar evento o puerta" secondary onPress={() => { setCamera(false); setupRef.current = null; setSetup(null); void loadEvents(); }} disabled={syncing || count > 0} />
      {count > 0 && <Subtext>Sincroniza los intentos pendientes antes de cambiar de puerta.</Subtext>}</Card>
      {lastResult && <View accessibilityRole="alert" style={{ backgroundColor: lastResult === 'valid' ? '#163B2B' : '#48202D', borderRadius: 18, padding: 18, marginVertical: 8 }}><Text style={{ color: lastResult === 'valid' ? palette.green : palette.red, fontSize: 24, fontWeight: '700' }}>{labels[lastResult]}</Text></View>}
      {camera && permission?.granted && !expired ? <View style={{ height: 300, borderRadius: 20, overflow: 'hidden' }}><CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => void capture(data)} /></View> : null}
      <Button title={camera ? 'Pausar cámara' : 'Activar cámara'} onPress={() => { if (!permission?.granted) void requestPermission().then((result) => setCamera(result.granted)); else setCamera(!camera); }} disabled={expired} secondary />
      {permission && !permission.granted && <Subtext>Permite usar la cámara en los ajustes del dispositivo para escanear códigos.</Subtext>}
      <Card><Input label="Código QR (verificación manual)" value={raw} onChangeText={setRaw} multiline /><Button title="Verificar y registrar intento" onPress={() => void capture(raw)} disabled={!raw || expired} secondary /></Card>
      <Label>Últimos intentos · historial persistente</Label></>}
    renderItem={({ item }) => <Card><Label>{labels[item.localResult]}</Label><Subtext>{item.ticketId ?? 'Código no verificable'} · {date(item.scannedAt)}</Subtext><Subtext>{item.serverResult ? `Servidor: ${item.serverResult}` : 'Pendiente de sincronizar'}</Subtext></Card>}
    ListEmptyComponent={<Subtext>Aún no has escaneado entradas en esta puerta.</Subtext>} />;
}
