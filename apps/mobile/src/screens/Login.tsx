import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import type { AuthResponse } from '@hypernova/contracts';
import { API_URL, login } from '../api';
import { Button, Heading, Input, Label, Loading, Message, palette, styles, Subtext } from '../ui';

export default function Login({ onLogin }: { onLogin: (session: AuthResponse) => void }): React.JSX.Element {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(): Promise<void> {
    setBusy(true); setError('');
    try { onLogin(await login(email.trim(), password, register ? name.trim() : undefined)); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión.'); }
    finally { setBusy(false); }
  }
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 50, paddingBottom: 30 }}>
      <Text style={{ color: palette.accent, fontSize: 12, letterSpacing: 5, marginBottom: 18 }}>HYPERNOVA LABS</Text>
      <Heading>Tu próxima experiencia empieza aquí.</Heading>
      <Subtext>Compra entradas, lleva tu billetera contigo y accede al evento.</Subtext>
      <View style={{ height: 30 }} />
      <Label>{register ? 'Crea tu cuenta' : 'Inicia sesión'}</Label>
      {register && <Input label="Nombre completo" value={name} onChangeText={setName} />}
      <Input label="Correo electrónico" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Input label="Contraseña" value={password} onChangeText={setPassword} secure />
      <Message text={error} error />
      {busy && <Loading />}
      <Button title={register ? 'Crear cuenta' : 'Entrar'} onPress={() => void submit()} disabled={busy || !email || !password || (register && !name)} />
      <Button title={register ? 'Ya tengo una cuenta' : 'Crear una cuenta'} secondary onPress={() => { setRegister(!register); setError(''); }} disabled={busy} />
      {!API_URL && <Message text="Falta EXPO_PUBLIC_API_URL. Consulta las instrucciones de ejecución." error />}
    </ScrollView>
  </KeyboardAvoidingView>;
}
