import React, { useEffect, useState } from 'react';
import { FlatList } from 'react-native';
import type { User } from '@hypernova/contracts';
import { api } from '../api';
import type { Page, Transfer } from '../types';
import { Button, Card, date, Heading, Label, Loading, Message, styles, Subtext } from '../ui';
import { stateLabel } from './Wallet';

export default function Transfers({ user, onChanged }: { user: User; onChanged: () => void }): React.JSX.Element {
  const [items, setItems] = useState<Transfer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function load(): Promise<void> {
    setBusy(true); setError('');
    try { setItems((await api<Page<Transfer>>('/transfers')).items); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron consultar las transferencias.'); }
    finally { setBusy(false); }
  }
  async function resolve(transfer: Transfer, accept: boolean): Promise<void> {
    setBusy(true); setError('');
    try { await api(`/transfers/${transfer.id}/${accept ? 'accept' : 'cancel'}`, 'POST', {}); setMessage(accept ? 'La entrada ya está en tu billetera. El código anterior fue revocado.' : 'Transferencia cancelada.'); onChanged(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la operación.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  return <FlatList style={styles.screen} contentContainerStyle={styles.content} data={items} keyExtractor={(item) => item.id} initialNumToRender={8}
    ListHeaderComponent={<><Heading>Transferencias</Heading><Subtext>Envía entradas desde tu billetera o acepta las que te compartieron.</Subtext><Message text={message} /><Message text={error} error />{busy && <Loading />}</>}
    ListEmptyComponent={!busy ? <Card><Subtext>No hay transferencias.</Subtext><Button title="Actualizar" secondary onPress={() => void load()} /></Card> : null}
    renderItem={({ item }) => <Card><Label>{item.fromUserId === user.id ? `Para ${item.toEmail}` : 'Una entrada para ti'}</Label><Subtext>Entrada {item.ticketId}</Subtext><Label>{stateLabel(item.state)}</Label><Subtext>{date(item.createdAt)}</Subtext>
      {item.state === 'pending' && item.toUserId === user.id && <Button title="Aceptar entrada" onPress={() => void resolve(item, true)} disabled={busy} />}
      {item.state === 'pending' && item.fromUserId === user.id && <Button title="Cancelar transferencia" secondary onPress={() => void resolve(item, false)} disabled={busy} />}</Card>}
    refreshing={busy} onRefresh={() => void load()} />;
}
