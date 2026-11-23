/**
 * «جرد جديد» from anywhere (quick actions, products menu, count report): if a count is still open, ask
 * «كمّل الجرد المفتوح» or «ابدأ جرد جديد» (the old one is kept in the report as cancelled).
 */
import { Alert } from 'react-native';
import { router } from 'expo-router';
import i18n from 'i18next';
import { getDb } from '../../db/client';
import { countLines, discardCount, getOpenCount } from '../../domain/inventory/adjust';
import type { InvCtx } from '../../domain/inventory/context';
import { useApp } from '../../state/app';
import { toast } from '../../state/toast';
import { invErrorMessage } from './errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t = (k: string, o?: Record<string, unknown>) => (i18n.t as any)(k, o) as string;

export function invCtxNow(): InvCtx | null {
  const s = useApp.getState();
  if (!s.user || !s.device) return null;
  return { db: getDb(), user: s.user, device: s.device, timezone: s.settings.timezone ?? 'Africa/Cairo', negativeStock: s.settings.negativeStock ?? 'warn', features: s.licence?.features ?? [] };
}

export async function startCountFlow(): Promise<void> {
  try {
    const open = await getOpenCount(getDb());
    if (!open) return void router.push('/products/count');
    const n = (await countLines(getDb(), open.id)).length;
    Alert.alert(t('countFlow.openTitle'), t('countFlow.openBody', { n, name: open.note ?? t('countFlow.unnamed') }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('countFlow.startNew'),
        style: 'destructive',
        onPress: () => {
          const ctx = invCtxNow();
          if (!ctx) return;
          void discardCount(ctx, open.id).then(
            () => {
              if (n) toast(t('countFlow.oldKept'));
              router.push('/products/count');
            },
            (e) => toast(invErrorMessage(i18n.t, e), 'error'),
          );
        },
      },
      { text: t('countFlow.resume'), onPress: () => router.push('/products/count') },
    ]);
  } catch (e) {
    toast(invErrorMessage(i18n.t, e), 'error');
  }
}
