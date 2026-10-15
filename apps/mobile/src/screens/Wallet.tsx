import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { ROTATION_SECONDS, signRotatingCode, verifyCredential } from '@hypernova/contracts';
import type { SignedCredential, User } from '@hypernova/contracts';
import { api } from '../api';
import { actionKey, cacheCredential, cacheTickets, finishAction, holderKey, wallet } from '../storage';
import type { Page, Ticket, WalletEntry } from '../types';
import { Button, Card, date, Heading, Input, Label, Loading, Message, money, palette, styles, Subtext } from '../ui';

const usable = (ticket: Ticket): boolean => ['paid', 'transferred'].includes(ticket.state);
export const stateLabel = (state: string): string => ({ paid: 'Pagada', transferred: 'Transferida', used: 'Usada', refunded: 'Reembolsada', void: 'Anulada', pending: 'Pendiente', accepted: 'Aceptada', cancelled: 'Cancelada', late_refunded: 'Pago tardío reembolsado' }[state] ?? state);

export default function Wallet({ user, revision }: { user: User; revision: number }): React.JSX.Element {
  const [entries, setEntries] = useState<WalletEntry[]>([]);
  const [selected, setSelected] = useState<WalletEntry | null>(null);
  const [seed, setSeed] = useState<string | null>(null);
  const [tick, setTick] = useState(Date.now());
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [offline, setOffline] = useState(false);
  async function refresh(): Promise<void> {
    setBusy(true); setError('');
    try {
      const tickets: Ticket[] = [];
      let cursor: string | null = null;
      do {
        const page: Page<Ticket> = await api<Page<Ticket>>(`/tickets${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
        tickets.push(...page.items); cursor = page.nextCursor;
      } while (cursor);
      await cacheTickets(user.id, tickets); setEntries(await wallet(user.id)); setOffline(false);
      if (selected) { setSelected(null); setSeed(null); }
    } catch (e) { setOffline(true); setError(e instanceof Error ? e.message : 'No se pudo actualizar la billetera.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void wallet(user.id).then(setEntries); void refresh(); }, [revision]);
  useEffect(() => { const timer = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const slot = Math.floor(tick / 1000 / ROTATION_SECONDS);
  const code = useMemo(() => {
    if (!selected?.credential || !seed || !usable(selected.ticket)) return '';
    try { return signRotatingCode(selected.credential, seed, slot * ROTATION_SECONDS); } catch { return ''; }
  }, [selected?.credential, seed, slot]);
  async function open(entry: WalletEntry): Promise<void> {
    setSelected(entry); setSeed(null); setEmail(''); setReason(''); setBusy(true); setError(''); setMessage('');
    try {
      if (!usable(entry.ticket)) return;
      const holder = await holderKey(user.id, entry.ticket.id);
      if (entry.credential && entry.credential.payload.holderPublicKey === holder.publicKey) { setSeed(holder.seed); return; }
      const result = await api<{ credential: SignedCredential; issuerPublicKey: string; keyId: string }>(`/tickets/${entry.ticket.id}/credential`, 'POST', { holderPublicKey: holder.publicKey });
      if (!verifyCredential(result.credential, { [result.keyId]: result.issuerPublicKey })) throw new Error('No se pudo verificar la credencial del servidor.');
      await cacheCredential(user.id, entry.ticket.id, result.credential);
      setSelected({ ...entry, credential: result.credential }); setSeed(holder.seed); setEntries(await wallet(user.id));
    } catch (e) { setError(e instanceof Error ? e.message : 'Necesitas conexión para preparar el código de esta entrada.'); }
    finally { setBusy(false); }
  }
  async function transfer(): Promise<void> {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      await api(`/tickets/${selected.ticket.id}/transfers`, 'POST', { email: email.trim() });
      setMessage('Transferencia pendiente. La persona recibirá la entrada al aceptarla en su app. Puedes cancelarla en Transferencias.'); setEmail('');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo transferir.'); }
    finally { setBusy(false); }
  }
  async function refund(): Promise<void> {
    if (!selected) return;
    setBusy(true); setError('');
    const operation = `refund:${selected.ticket.id}:${reason}`;
    try {
      await api(`/tickets/${selected.ticket.id}/refund`, 'POST', { reason }, await actionKey(user.id, operation));
      await finishAction(user.id, operation); setSelected(null); setSeed(null); await refresh(); setMessage('Reembolso completado. La entrada dejó de ser válida.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo reembolsar.'); }
    finally { setBusy(false); }
  }
  const header = <><Heading>Tu billetera</Heading><Subtext>Abre cada entrada una vez con conexión para llevar su código sin red.</Subtext>
    {offline && <Message text="Mostrando entradas guardadas. Conecta para consultar cambios de estado." />}
    <Message text={message} /><Message text={error} error />{busy && <Loading />}</>;
  if (selected) return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>{header}
    <Button title="← Todas mis entradas" secondary onPress={() => { setSelected(null); setSeed(null); }} />
    <Card><Heading>{selected.ticket.eventName}</Heading><Label>{selected.ticket.zoneName} · {stateLabel(selected.ticket.state)}</Label><Subtext>{selected.ticket.id}</Subtext>
      {!!code && tick / 1000 < (selected.credential?.payload.expiresAt ?? 0) && <View style={{ alignItems: 'center', gap: 10 }}><View style={{ backgroundColor: '#FFFFFF', borderRadius: 18, padding: 15 }}><QRCode value={code} size={260} ecl="L" /></View>
        <Text style={{ color: palette.green }}>El código cambia en {ROTATION_SECONDS - Math.floor(tick / 1000) % ROTATION_SECONDS} s</Text></View>}
      {selected.credential && tick / 1000 >= selected.credential.payload.expiresAt && <Message text="Esta credencial venció." error />}
      {usable(selected.ticket) && !code && !busy && <Button title="Preparar código con conexión" onPress={() => void open(selected)} />}
      <Subtext>Emitida {date(selected.ticket.issuedAt)} · {money(selected.ticket.amountCents)}</Subtext>
    </Card>
    {usable(selected.ticket) && <><Card><Label>Transferir entrada</Label><Input label="Correo del destinatario" value={email} onChangeText={setEmail} keyboardType="email-address" /><Button title="Enviar transferencia" onPress={() => void transfer()} disabled={busy || !email.includes('@')} /></Card>
      <Card><Label>Solicitar reembolso</Label><Subtext>El servidor verifica el plazo y que la entrada no haya sido utilizada.</Subtext><Input label="Motivo del reembolso" value={reason} onChangeText={setReason} /><Button title="Confirmar reembolso" secondary onPress={() => void refund()} disabled={busy || !reason.trim()} /></Card></>}
  </ScrollView>;
  return <FlatList style={styles.screen} data={entries} keyExtractor={(entry) => entry.ticket.id} contentContainerStyle={styles.content} ListHeaderComponent={header}
    ListEmptyComponent={!busy ? <Card><Subtext>Aún no tienes entradas. Explora los eventos para comprar.</Subtext><Button title="Actualizar billetera" secondary onPress={() => void refresh()} /></Card> : null}
    renderItem={({ item }) => <Card><Heading>{item.ticket.eventName}</Heading><Subtext>{item.ticket.zoneName} · {stateLabel(item.ticket.state)}</Subtext><Subtext>{money(item.ticket.amountCents)}</Subtext><Button title={usable(item.ticket) ? 'Ver entrada y código' : 'Ver detalle'} onPress={() => void open(item)} /></Card>}
    refreshing={busy} onRefresh={() => void refresh()} initialNumToRender={6} />;
}
