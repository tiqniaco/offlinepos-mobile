/**
 * New phone joins an existing shop as a cashier phone: scan the QR shown on the shop's phone
 * («موبايلات المحل» → «ضيف موبايل كاشير»). No phone number or SMS: the QR is the invitation (one use, 15 minutes).
 */
import { useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { catalogAad, openSync, parseJoinQr, type SyncJoinResponse } from '@daftarak/shared';
import { OnboardingScreen, Text, Button, Banner, colors, fonts } from '../../ui';
import { api, ApiError } from '../../api/client';
import { getDb } from '../../db/client';
import { deviceInfo } from '../../domain/onboarding';
import { integrityToken } from '../../features/integrity/integrity';
import { setSecret, SECURE_KEYS } from '../../lib/secure';
import { useAccessToken } from '../../lib/session';
import { writeCashierLocal } from '../../domain/sync/local';
import type { Catalog } from '../../domain/sync/catalog';
import { setMeta } from '../../domain/device';
import { refreshLicenceState, storeLicence } from '../../domain/licence/service';
import { reloadAppData } from '../../state/boot';
import { useApp } from '../../state/app';
import { errorMessage } from '../../lib/errors';
import { NativeScanner } from '../scan';
import { fx } from '../../ui/fx';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Join() {
  const { t } = useTranslation();
  const [step, setStep] = useState<'scan' | 'working' | 'error'>('scan');
  const [err, setErr] = useState<string | null>(null);
  const joined = useRef<{ j: SyncJoinResponse; key: string } | null>(null);
  const busy = useRef(false);

  const finish = async () => {
    const x = joined.current!;
    const { j, key } = x;
    // The shop's catalog (uploaded by the shop's phone before showing the QR); a few tries if it is not there yet.
    let got: { version: number; blob: Uint8Array } | null = null;
    for (let i = 0; i < 8 && !got; i++) {
      try {
        got = await api.syncGetCatalog(j.accessToken, j.deviceId);
      } catch (e) {
        if (!(e instanceof ApiError && e.code === 'not_found') || i === 7) throw e;
        await wait(5000);
      }
    }
    const cat = openSync<Catalog>(key, got!.blob, catalogAad(j.business.id));
    const db = getDb();
    await writeCashierLocal(db, j, key, cat, Platform.OS === 'ios' ? 'ios' : 'android');
    await setMeta(db, 'sync.catalogVersion', String(got!.version));
    await storeLicence(db, j.licence, j.serverTime);
    await refreshLicenceState(db);
    await reloadAppData();
    fx.success();
    useApp.getState().set({ status: 'locked' });
  };

  const onCode = async (text: string) => {
    if (busy.current) return;
    const q = parseJoinQr(text);
    if (!q) {
      setErr(t('join.notOurs'));
      return;
    }
    busy.current = true;
    setStep('working');
    setErr(null);
    try {
      if (!joined.current) {
        const j = await api.syncJoin(q.code, await deviceInfo(), await integrityToken('attach'));
        await setSecret(SECURE_KEYS.refreshToken, j.refreshToken);
        useAccessToken(j.accessToken, j.accessExpiresAt);
        joined.current = { j, key: q.syncKey };
      }
      await finish();
    } catch (e) {
      setErr(e instanceof ApiError && e.code === 'code_invalid' ? t('join.codeInvalid') : errorMessage(t, e));
      setStep(joined.current ? 'error' : 'scan');
    } finally {
      busy.current = false;
    }
  };

  return (
    <OnboardingScreen title={t('join.title')} subtitle={t('join.subtitle')}>
      {step === 'scan' ? (
        <View style={{ height: 320, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000' }}>
          {Platform.OS === 'web' ? null : <NativeScanner onCode={(c) => void onCode(c)} onError={(m) => setErr(m)} />}
        </View>
      ) : (
        <View style={{ padding: 24, alignItems: 'center', gap: 8 }}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 27, color: colors.ink.DEFAULT, textAlign: 'center' }}>{step === 'working' ? t('join.working') : t('join.failed')}</Text>
          {step === 'error' ? <Button icon="refresh" title={t('common.retry')} onPress={() => void (async () => { setStep('working'); try { await finish(); } catch (e) { setErr(errorMessage(t, e)); setStep('error'); } })()} /> : null}
        </View>
      )}
      {err ? <Banner tone="danger" text={err} /> : null}
      <Banner tone="info" icon="info" text={t('join.how')} />
      <Button kind="ghost" title={t('common.back')} onPress={() => router.back()} />
    </OnboardingScreen>
  );
}
