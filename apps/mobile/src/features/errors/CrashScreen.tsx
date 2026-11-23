/**
 * Shown instead of a blank/black screen when a screen fails to render (release builds show nothing otherwise).
 * The error text is also sent to the server (no personal data) so it can be fixed without the phone's logs.
 */
import { useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Pressable } from '../../ui/Press';
import { API_URL, APP_VERSION } from '../../config/env';
import { Platform } from 'react-native';

let lastSent = '';
export function reportClientError(error: unknown, where: string) {
  const e = error instanceof Error ? error : new Error(String(error));
  const key = `${where}:${e.message}`;
  if (key === lastSent) return;
  lastSent = key;
  void fetch(`${API_URL}/v1/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ where, message: e.message.slice(0, 500), stack: (e.stack ?? '').slice(0, 1500), appVersion: APP_VERSION, platform: Platform.OS }),
  }).catch(() => undefined);
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
