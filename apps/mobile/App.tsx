import React, { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, StatusBar, Text, View } from 'react-native';
import type { AuthResponse } from '@hypernova/contracts';
import { logout, onSessionExpired, restoreSession } from './src/api';
import { database } from './src/storage';
import Login from './src/screens/Login';
import Events from './src/screens/Events';
import Wallet from './src/screens/Wallet';
import History from './src/screens/History';
import Transfers from './src/screens/Transfers';
import Scanner from './src/screens/Scanner';
import { Loading, Message, palette } from './src/ui';

type Tab = 'events' | 'wallet' | 'transfers' | 'history' | 'scanner';
export default function App(): React.JSX.Element {
  const [session, setSession] = useState<AuthResponse | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [tab, setTab] = useState<Tab>('events');
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    onSessionExpired(() => setSession(null));
    void Promise.all([restoreSession(), database()]).then(([saved]) => { setSession(saved); if (saved?.user.role === 'staff') setTab('scanner'); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo abrir el almacenamiento local.')).finally(() => setInitializing(false));
  }, []);
  async function signOut(): Promise<void> {
    setLeaving(true); setError('');
    try { await logout(); setSession(null); setTab('events'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Conecta para cerrar la sesión y revocar el acceso en el servidor.'); }
    finally { setLeaving(false); }
  }
  if (initializing) return <SafeAreaView style={{ flex: 1, backgroundColor: palette.background, justifyContent: 'center' }}><Loading /></SafeAreaView>;
  return <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}><StatusBar barStyle="light-content" />
    {session ? <>
      <View style={{ paddingHorizontal: 18, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View><Text style={{ color: palette.accent, fontSize: 11, letterSpacing: 3 }}>HYPERNOVA</Text><Text style={{ color: palette.muted, fontSize: 12, marginTop: 3 }}>{session.user.name} · {session.user.role}</Text></View>
        <Pressable accessibilityRole="button" onPress={() => void signOut()} disabled={leaving}><Text style={{ color: palette.muted }}>{leaving ? 'Cerrando…' : 'Salir'}</Text></Pressable>
      </View><View style={{ paddingHorizontal: 18 }}><Message text={error} error /></View>
      <View style={{ flex: 1 }}>{tab === 'events' ? <Events user={session.user} onPurchased={() => setRevision((value) => value + 1)} />
        : tab === 'wallet' ? <Wallet user={session.user} revision={revision} />
        : tab === 'history' ? <History />
        : tab === 'transfers' ? <Transfers user={session.user} onChanged={() => setRevision((value) => value + 1)} />
        : <Scanner user={session.user} />}</View>
      <View style={{ flexDirection: 'row', paddingTop: 10, paddingBottom: 12, borderTopWidth: 1, borderColor: palette.border }}>
        {([
          { id: 'events', title: 'Eventos' }, { id: 'wallet', title: 'Billetera' }, { id: 'transfers', title: 'Transferir' }, { id: 'history', title: 'Historial' },
          ...(['staff', 'admin'].includes(session.user.role) ? [{ id: 'scanner', title: 'Escanear' }] : []),
        ] as { id: Tab; title: string }[]).map((item) => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }}
          onPress={() => { setTab(item.id); setError(''); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 10 }}>
          <Text style={{ color: tab === item.id ? palette.accent : palette.muted, fontSize: 11, fontWeight: tab === item.id ? '700' : '400' }}>{item.title}</Text>
        </Pressable>)}
      </View>
    </> : <Login onLogin={(value) => { setSession(value); setError(''); setTab(value.user.role === 'staff' ? 'scanner' : 'events'); }} />}
  </SafeAreaView>;
}
