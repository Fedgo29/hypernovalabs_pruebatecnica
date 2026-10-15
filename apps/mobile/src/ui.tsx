import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export const palette = { background: '#10111F', surface: '#1C1E30', muted: '#A6ABC8', text: '#F3F4FF', accent: '#B9A4FF', green: '#85E0B5', red: '#FF8D9C', border: '#33364F' };
export const money = (cents: number): string => `$ ${(cents / 100).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const date = (value?: string): string => value ? new Date(value).toLocaleString('es-CO') : '—';
export function Label({ children }: React.PropsWithChildren): React.JSX.Element { return <Text style={styles.label}>{children}</Text>; }
export function Heading({ children }: React.PropsWithChildren): React.JSX.Element { return <Text style={styles.heading}>{children}</Text>; }
export function Subtext({ children }: React.PropsWithChildren): React.JSX.Element { return <Text style={styles.subtext}>{children}</Text>; }
export function Card({ children }: React.PropsWithChildren): React.JSX.Element { return <View style={styles.card}>{children}</View>; }
export function Button({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }): React.JSX.Element {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} onPress={onPress} disabled={disabled}
    style={({ pressed }) => [styles.button, secondary && styles.secondary, (disabled || pressed) && { opacity: 0.5 }]}>
    <Text style={[styles.buttonText, secondary && { color: palette.text }]}>{title}</Text>
  </Pressable>;
}
export function Input({ label, value, onChangeText, secure = false, keyboardType = 'default', multiline = false }: {
  label: string; value: string; onChangeText: (value: string) => void; secure?: boolean;
  keyboardType?: 'default' | 'email-address' | 'number-pad'; multiline?: boolean;
}): React.JSX.Element {
  return <View style={styles.field}><Label>{label}</Label><TextInput style={[styles.input, multiline && { minHeight: 90 }]}
    value={value} onChangeText={onChangeText} secureTextEntry={secure} keyboardType={keyboardType} autoCapitalize="none"
    autoCorrect={false} placeholderTextColor={palette.muted} multiline={multiline} accessibilityLabel={label} /></View>;
}
export function Message({ text, error = false }: { text?: string | null; error?: boolean }): React.JSX.Element | null {
  return text ? <Text accessibilityRole={error ? 'alert' : 'text'} style={[styles.message, { color: error ? palette.red : palette.green }]}>{text}</Text> : null;
}
export function Loading(): React.JSX.Element { return <ActivityIndicator size="large" color={palette.accent} style={{ padding: 24 }} />; }
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background, paddingHorizontal: 18 },
  content: { paddingBottom: 30, gap: 12 },
  heading: { color: palette.text, fontSize: 25, fontWeight: '700', marginBottom: 8 },
  subtext: { color: palette.muted, fontSize: 14, lineHeight: 21 },
  label: { color: palette.text, fontSize: 15, fontWeight: '600', marginBottom: 5 },
  card: { backgroundColor: palette.surface, borderRadius: 18, padding: 18, gap: 10, marginVertical: 6, borderWidth: 1, borderColor: palette.border },
  button: { backgroundColor: palette.accent, borderRadius: 12, minHeight: 46, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14, marginVertical: 4 },
  secondary: { backgroundColor: palette.border },
  buttonText: { color: palette.background, fontSize: 15, fontWeight: '700' },
  field: { marginVertical: 7 },
  input: { color: palette.text, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 12, padding: 12, minHeight: 48 },
  message: { paddingVertical: 9, lineHeight: 21, fontSize: 14 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
});
