/**
 * WhatsApp everywhere (owner request): a chat with text opens directly (wa.me); files (PDF/Excel) go
 * through the share sheet where WhatsApp is one tap (PLAN.md D-08 — wa.me links cannot carry files).
 */
import { Linking } from 'react-native';
import * as Sharing from 'expo-sharing';
import i18n from 'i18next';
import { normalizePhone } from '@daftarak/shared';
import { toast } from '../../state/toast';

/** Digits only, international format without "+", e.g. 201012345678. */
export function waNumber(mobile: string | null | undefined): string {
  return normalizePhone(mobile ?? '', 'EG') ?? (mobile ?? '').replace(/\D/g, '');
}

export async function openWhatsApp(mobile: string | null | undefined, text: string): Promise<void> {
  const n = waNumber(mobile);
  const url = `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
  try {
    await Linking.openURL(url);
  } catch {
    toast(i18n.t('share.noWhatsApp'), 'error');
  }
}

export async function callPhone(mobile: string | null | undefined) {
  const n = waNumber(mobile);
  if (n) await Linking.openURL(`tel:+${n}`).catch(() => undefined);
}

/** Share a file through the system sheet (WhatsApp, email, Drive…). */
export async function shareFile(uri: string, mimeType: string, title: string, uti?: string) {
  if (!(await Sharing.isAvailableAsync())) return toast(i18n.t('share.unavailable'), 'error');
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: title, UTI: uti });
}
