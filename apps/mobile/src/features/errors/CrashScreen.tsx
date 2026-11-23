/**
 * Shown instead of a blank/black screen when a screen fails to render (release builds show nothing otherwise).
 * The error text is also sent to the server (no personal data) so it can be fixed without the phone's logs.
 */
import { useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Pressable } from '../../ui/Press';
import { API_URL, APP_VERSION } from '../../config/env';
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';

let lastSent = '';

interface ClientErrorPayload {
  where: string;
  message: string;
  stack: string;
  appVersion: string;
  platform: string;
  at?: number;
}

export function clientErrorPayload(error: unknown, where: string): ClientErrorPayload {
  const e = error instanceof Error ? error : new Error(String(error));
  return { where, message: e.message.slice(0, 500), stack: (e.stack ?? '').slice(0, 1500), appVersion: APP_VERSION, platform: Platform.OS };
}

/** POST one report; true when the server took it (used to clear reports saved after a crash). */
export async function sendClientError(p: ClientErrorPayload): Promise<boolean> {
  try {
    const r = await fetch(`${API_URL}/v1/client-errors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
    return r.ok;
  } catch {
    return false;
  }
}

export function reportClientError(error: unknown, where: string) {
  const p = clientErrorPayload(error, where);
  const key = `${where}:${p.message}`;
  if (key === lastSent) return;
  lastSent = key;
  void sendClientError(p);
}

// A fatal JS error usually kills the app before the network request leaves: keep it in a small file and send it
// on the next launch (flushPendingErrors, called from boot).
const PENDING = 'pending-client-errors.json';
const pendingFile = () => new File(Paths.document, PENDING);

export function persistClientError(error: unknown, where: string) {
  try {
    const f = pendingFile();
    let list: ClientErrorPayload[] = [];
    if (f.exists) {
      try {
        list = JSON.parse(f.textSync()) as ClientErrorPayload[];
      } catch {
        list = [];
      }
    } else f.create();
    list.push({ ...clientErrorPayload(error, where), at: Date.now() });
    f.writeSync(JSON.stringify(list.slice(-5)));
  } catch {
    /* never let error reporting crash the crash handler */
  }
}

export async function flushPendingErrors() {
  try {
    const f = pendingFile();
    if (!f.exists) return;
    let list: ClientErrorPayload[] = [];
    try {
      list = JSON.parse(await f.text()) as ClientErrorPayload[];
    } catch {
      list = [];
    }
    const left: ClientErrorPayload[] = [];
    for (const p of list) if (!(await sendClientError({ ...p, where: `${p.where}:previous-launch` }))) left.push(p);
    if (left.length) f.writeSync(JSON.stringify(left));
    else f.delete();
  } catch {
    /* next launch */
  }
}

export function CrashScreen({ error, retry, where }: { error: Error; retry: () => Promise<void> | void; where: string }) {
  useEffect(() => reportClientError(error, where), [error, where]);
  return (
    <View style={{ flex: 1, backgroundColor: '#F8F9FC', padding: 24, paddingTop: 72, gap: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color: '#101828', textAlign: 'right' }}>حصلت مشكلة في الشاشة دي</Text>
      <Text style={{ fontSize: 15, color: '#475467', textAlign: 'right', lineHeight: 24 }}>بياناتك سليمة ومحفوظة. اتبعت تفاصيل المشكلة لفريق كاشيرو عشان نصلّحها. جرّب تاني.</Text>
      <Pressable onPress={() => void retry()} style={({ pressed }) => ({ backgroundColor: '#0F4CC7', borderRadius: 12, paddingVertical: 14, alignItems: 'center', opacity: pressed ? 0.85 : 1 })}>
        <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>حاول تاني</Text>
      </Pressable>
      <ScrollView style={{ maxHeight: 220, backgroundColor: '#EAECF0', borderRadius: 12, padding: 12 }}>
        <Text selectable style={{ fontSize: 11, color: '#475467', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
          {error.message}
          {'\n'}
          {(error.stack ?? '').split('\n').slice(0, 6).join('\n')}
        </Text>
      </ScrollView>
    </View>
  );
}
