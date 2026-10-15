import React, { useEffect, useState } from 'react';
import { FlatList } from 'react-native';
import { api } from '../api';
import type { Page, Purchase } from '../types';
import { Button, Card, date, Heading, Label, Loading, Message, money, styles, Subtext } from '../ui';
import { stateLabel } from './Wallet';

export default function History(): React.JSX.Element {
  const [items, setItems] = useState<Purchase[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load(next = false): Promise<void> {
    setBusy(true); setError('');
    try { const page = await api<Page<Purchase>>(`/purchases${next && cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`); setItems((old) => next ? [...old, ...page.items] : page.items); setCursor(page.nextCursor); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo consultar el historial.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  return <FlatList style={styles.screen} contentContainerStyle={styles.content} data={items} keyExtractor={(item) => item.id} initialNumToRender={8}
    ListHeaderComponent={<><Heading>Compras y reembolsos</Heading><Subtext>El estado de cada entrada se encuentra en tu billetera.</Subtext><Message text={error} error />{busy && <Loading />}</>}
    ListEmptyComponent={!busy ? <Card><Subtext>No tienes compras registradas.</Subtext><Button title="Actualizar" secondary onPress={() => void load()} /></Card> : null}
    renderItem={({ item }) => <Card><Label>{item.eventName ?? `Evento ${item.eventId ?? ''}`}</Label><Subtext>{item.id}</Subtext><Label>{stateLabel(item.state)} · {money(item.amountCents)}</Label><Subtext>{date(item.paidAt ?? item.createdAt)}</Subtext>{item.refundedAt && <Subtext>Reembolso: {date(item.refundedAt)}</Subtext>}</Card>}
    refreshing={busy} onRefresh={() => void load()} onEndReached={() => { if (cursor && !busy) void load(true); }} onEndReachedThreshold={0.5} />;
}
