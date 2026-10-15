import React, { useEffect, useRef, useState } from 'react';
import { FlatList, ScrollView, Text } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { User } from '@hypernova/contracts';
import { api } from '../api';
import { actionKey, finishAction, getLocal, removeLocal, setLocal } from '../storage';
import type { Event, Page, Reservation, Zone } from '../types';
import { Button, Card, date, Heading, Input, Label, Loading, Message, money, palette, styles, Subtext } from '../ui';

export default function Events({ user, onPurchased }: { user: User; onPurchased: () => void }): React.JSX.Element {
  const [items, setItems] = useState<Event[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [zone, setZone] = useState<Zone | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const operationLock = useRef(false);
  async function load(next = false): Promise<void> {
    setBusy(true); setError('');
    try {
      const page = await api<Page<Event>>(`/events?limit=30${next && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      setItems((existing) => next ? [...existing, ...page.items] : page.items); setCursor(page.nextCursor);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron cargar los eventos.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); void getLocal<Reservation>(`reservation:${user.id}`).then(setReservation); }, []);
  useEffect(() => {
    if (!reservation) return;
    const update = (): void => setSeconds(Math.max(0, Math.ceil((Date.parse(reservation.expiresAt) - Date.now()) / 1000)));
    update(); const timer = setInterval(update, 1000); return () => clearInterval(timer);
  }, [reservation]);
  async function open(item: Event): Promise<void> {
    setBusy(true); setError(''); setMessage('');
    try { setEvent(await api<Event>(`/events/${item.id}`)); setZone(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo abrir el evento.'); }
    finally { setBusy(false); }
  }
  async function reserve(): Promise<void> {
    if (!zone || operationLock.current) return;
    operationLock.current = true;
    setBusy(true); setError(''); setMessage('');
    const operation = `reserve:${zone.id}:${quantity}`;
    try {
      const result = await api<Reservation>('/reservations', 'POST', { zoneId: zone.id, quantity: Number(quantity) }, await actionKey(user.id, operation));
      const saved = { ...result, paymentKey: Crypto.randomUUID() };
      await setLocal(`reservation:${user.id}`, saved); setReservation(saved); await finishAction(user.id, operation);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo reservar.'); }
    finally { operationLock.current = false; setBusy(false); }
  }
  async function pay(): Promise<void> {
    if (!reservation || operationLock.current) return;
    operationLock.current = true;
    setBusy(true); setError('');
    try {
      const result = await api<{ state: string; amountCents: number }>(`/reservations/${reservation.id}/pay`, 'POST', {}, reservation.paymentKey ?? await actionKey(user.id, `pay:${reservation.id}`));
      await removeLocal(`reservation:${user.id}`); setReservation(null); setEvent(null);
      setMessage(result.state === 'paid' ? `Compra completada: ${money(result.amountCents)}. Tus entradas están en la billetera.` : 'La reserva venció. El pago tardío se reembolsó automáticamente.');
      onPurchased(); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo confirmar el pago. Puedes reintentar la misma compra.'); }
    finally { operationLock.current = false; setBusy(false); }
  }
  async function cancel(): Promise<void> {
    if (!reservation || operationLock.current) return;
    operationLock.current = true;
    setBusy(true); setError('');
    try { await api(`/reservations/${reservation.id}/cancel`, 'POST', {}); await removeLocal(`reservation:${user.id}`); setReservation(null); setMessage('Reserva cancelada.'); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cancelar.'); }
    finally { operationLock.current = false; setBusy(false); }
  }
  const header = <><Heading>Encuentra tu próximo evento</Heading><Subtext>Disponibilidad y precios confirmados al reservar.</Subtext><Message text={message} /><Message text={error} error />
    {busy && <Loading />}
    {reservation && <Card><Label>Reserva {reservation.id.slice(0, 8)}</Label><Text style={{ color: seconds ? palette.green : palette.red, fontSize: 28, fontWeight: '700' }}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</Text>
      <Subtext>{reservation.quantity} entrada(s) · {money(reservation.amountCents)}</Subtext><Subtext>{seconds ? 'Tu cupo está reservado hasta que termine el contador.' : 'La reserva venció. Ya no protege un cupo.'}</Subtext>
      <Button title={seconds ? 'Confirmar pago simulado' : 'Resolver pago tardío'} onPress={() => void pay()} disabled={busy} /><Button title="Cancelar reserva" secondary onPress={() => void cancel()} disabled={busy} /></Card>}
  </>;
  if (event) return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    {header}<Button title="← Todos los eventos" secondary onPress={() => { setEvent(null); setZone(null); }} />
    <Card><Heading>{event.name}</Heading><Subtext>{date(event.startsAt)} · {event.venue}</Subtext><Subtext>Máximo {event.perAccountLimit} entradas por cuenta. Reembolsos hasta {date(event.refundUntil)}.</Subtext></Card>
    {event.zones.length === 0 && <Subtext>Este evento todavía no tiene zonas disponibles.</Subtext>}
    {event.zones.map((item) => <Card key={item.id}><Label>{item.name}</Label><Subtext>{item.available} disponibles · {item.priceCents === null ? 'Venta cerrada' : money(item.priceCents)}</Subtext>
      <Button title={zone?.id === item.id ? 'Zona seleccionada' : 'Seleccionar zona'} onPress={() => setZone(item)} disabled={busy || item.available <= 0 || item.priceCents === null || !!reservation} secondary={zone?.id !== item.id} /></Card>)}
    {zone && !reservation && <Card><Input label="Cantidad de entradas" value={quantity} onChangeText={setQuantity} keyboardType="number-pad" /><Button title="Reservar entradas" onPress={() => void reserve()} disabled={busy || !/^\d+$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > event.perAccountLimit} /></Card>}
  </ScrollView>;
  return <FlatList style={styles.screen} contentContainerStyle={styles.content} data={items} keyExtractor={(item) => String(item.id)}
    ListHeaderComponent={header} ListEmptyComponent={!busy ? <Card><Subtext>No hay eventos publicados.</Subtext><Button title="Volver a cargar" secondary onPress={() => void load()} /></Card> : null}
    renderItem={({ item }) => <Card><Heading>{item.name}</Heading><Subtext>{date(item.startsAt)} · {item.venue}</Subtext><Subtext>{item.zones.reduce((sum, value) => sum + value.available, 0)} entradas disponibles</Subtext><Button title="Ver zonas y comprar" onPress={() => void open(item)} disabled={busy} /></Card>}
    refreshing={busy} onRefresh={() => void load()} onEndReached={() => { if (cursor && !busy) void load(true); }} onEndReachedThreshold={0.5} initialNumToRender={6} />;
}
