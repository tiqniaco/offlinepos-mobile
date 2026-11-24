import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { OnboardingScreen, Text, Button, Card, Banner, IconBadge, OtpInput, Chip, colors, fonts } from '../../ui';
import { useOnboarding } from '../../state/app';
import { api, ApiError } from '../../api/client';
import { setSecret, SECURE_KEYS } from '../../lib/secure';
import { useAccessToken } from '../../lib/session';
import { deviceInfo } from '../../domain/onboarding';
import { storeLicence, refreshLicenceState } from '../../domain/licence/service';
import { getDb } from '../../db/client';
import { boot } from '../../state/boot';
import { applyRestore, RestoreError, stageRestore, type RestorePreview } from '../../features/backup/service';
import { setRestoreBusinessId } from '../../features/backup/restoreState';
import { dayText } from '../../features/export/builders';
import { errorMessage } from '../../lib/errors';
import { fx } from '../../ui/fx';
import { syncOwnerPassword } from '../../domain/auth/users';
import { getCurrentDevice, setMeta } from '../../domain/device';
import { useSmsOtp } from '../../features/auth/useSmsOtp';
import { SmsOtpHint } from '../../features/auth/SmsOtpHint';

type Backup = Awaited<ReturnType<typeof api.listBackups>>['backups'][number];
type Step = 'list' | 'otp' | 'working' | 'preview' | 'installing';

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 10 * 1024 * 1024 ? 0 : 1)} MB`;
const day = (ms: number) => {
  const d = new Date(ms);
  return dayText(d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate());
};

/** New phone: restore the business from its encrypted cloud backup (PLAN.md §9.4), or from its own backup file. */
export default function Restore() {
  const { t } = useTranslation();
  const auth = useOnboarding((s) => s.auth);
  const businessId = useOnboarding((s) => s.existingBusinessId);
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('list');
  const [code, setCode] = useState('');
  const [progress, setProgress] = useState<{ p: number; stage: string }>({ p: 0, stage: '' });
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const verifying = useRef(false);
  // Android: listen for the SMS while the code step is open; the allowed code fills the boxes and verifies once.
  const sms = useSmsOtp((c) => {
    if (step !== 'otp' || verifying.current) return;
    setCode(c);
    void verify(c);
  }, step === 'otp');

  useEffect(() => {
    if (!auth || !businessId) return;
    setRestoreBusinessId(businessId);
    useAccessToken(auth.accessToken, auth.accessExpiresAt);
    void api.listBackups(auth.accessToken, businessId).then(
      (r) => {
        setBackups(r.backups);
        setPick(r.backups[0]?.id ?? null);
      },
      (e) => setErr(errorMessage(t, e)),
    );
  }, [auth, businessId, t]);
  if (!auth || !businessId) return null;

  const sendOtp = async () => {
    setErr(null);
    sms.restart(); // listen before the SMS is sent (it can arrive within seconds)
    try {
      await api.stepUpRequest(auth.accessToken);
      setStep('otp');
    } catch (e) {
      setErr(errorMessage(t, e));
    }
  };
  const verify = async (value = code) => {
    if (verifying.current || value.length !== 6) return;
    verifying.current = true;
    setVerifyBusy(true);
    setErr(null);
    try {
      await api.stepUpVerify(auth.accessToken, value);
      setStep('working');
      const pv = await stageRestore(auth.accessToken, pick!, (p, stage) => setProgress({ p, stage }));
      setPreview(pv);
      setStep('preview');
    } catch (e) {
      setErr(e instanceof ApiError ? errorMessage(t, e) : e instanceof RestoreError ? t(`restore.err.${e.code}`) : t('restore.decryptFailed'));
      setStep(e instanceof ApiError && e.code === 'otp_invalid' ? 'otp' : 'list');
    } finally {
      verifying.current = false;
      setVerifyBusy(false);
    }
  };
  const install = async () => {
    setErr(null);
    setStep('installing');
    try {
      const reg = await applyRestore(auth.accessToken, businessId, await deviceInfo());
      await setSecret(SECURE_KEYS.refreshToken, auth.refreshToken);
      await storeLicence(getDb(), reg.registration.licence, reg.registration.serverTime);
      await refreshLicenceState(getDb());
      // The restored owner opens with the CURRENT account password on this phone.
      const pw = useOnboarding.getState().password;
      const dev = await getCurrentDevice(getDb());
      if (pw && dev) await syncOwnerPassword(getDb(), pw, dev.id);
      await setMeta(getDb(), 'account.phone', auth.account.phone);
      useOnboarding.getState().reset();
      fx.success();
      await boot(); // restored users → lock screen
    } catch (e) {
      setErr(e instanceof RestoreError ? t(`restore.err.${e.code}`) : errorMessage(t, e));
      setStep('preview');
    }
  };

  return (
    <OnboardingScreen
      step={3}
      stepLabel={t('onboarding.step', { n: 3, total: 4 })}
      title={t('restore.title')}
      subtitle={t('restore.subtitle')}
      footer={
        step === 'list' ? (
          <>
            <Button testID="restore-start" icon="download" title={t('restore.start')} disabled={!pick} onPress={() => void sendOtp()} />
            <Button kind="secondary" icon="file" title={t('restore.fromFile')} onPress={() => router.push('/restore-file')} />
            <Button kind="ghost" title={t('restore.startEmpty')} onPress={() => router.push('/owner')} />
          </>
        ) : step === 'otp' ? (
          <Button title={t('restore.verify')} loading={verifyBusy} disabled={code.length !== 6 || verifyBusy} onPress={() => void verify()} />
        ) : step === 'preview' ? (
          <Button testID="restore-confirm" icon="check" title={t('restore.confirm')} onPress={() => void install()} />
        ) : null
      }
    >
      {err ? <Banner tone="danger" text={err} /> : null}
      {step === 'list' ? (
        backups == null ? (
          <Text variant="caption">{t('restore.loading')}</Text>
        ) : backups.length === 0 ? (
          <Banner tone="warn" text={t('restore.none')} />
        ) : (
          <>
            {backups.slice(0, 8).map((b) => (
              <Card key={b.id} onPress={() => setPick(b.id)} style={{ borderWidth: 2, borderColor: pick === b.id ? colors.primary[500] : 'transparent' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <IconBadge name="cloudOff" hue={pick === b.id ? 'primary' : 'ink'} size={36} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21, color: colors.ink.DEFAULT }}>{day(b.at)} · {new Date(b.at).toTimeString().slice(0, 5)}</Text>
                    <Text variant="caption">{t('restore.counts', { inv: b.counts.invoices ?? 0, prod: b.counts.products ?? 0 })} · {mb(b.size)} · {t('restore.device', { code: b.deviceCode ?? '?' })}</Text>
                  </View>
                  {pick === b.id ? <Chip label={t('restore.chosen')} selected /> : null}
                </View>
              </Card>
            ))}
            <Banner tone="info" text={t('restore.otpNote')} />
          </>
        )
      ) : null}
      {step === 'otp' ? (
        <>
          <Text variant="body">{t('restore.otpSent')}</Text>
          <OtpInput value={code} onChange={setCode} />
          <SmsOtpHint show={sms.supported} />
        </>
      ) : null}
      {step === 'working' || step === 'installing' ? (
        <Card>
          <Text variant="subtitle">{step === 'installing' ? t('restore.installing') : progress.stage === 'download' ? t('restore.downloading') : t('restore.decrypting')}</Text>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.paper.sunk, marginTop: 10, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round((step === 'installing' ? 1 : progress.p) * 100)}%`, height: 8, backgroundColor: colors.primary[500] }} />
          </View>
          <Text variant="caption" style={{ marginTop: 6 }}>{t('restore.keepOpen')}</Text>
        </Card>
      ) : null}
      {step === 'preview' && preview ? (
        <Card>
          <Text style={{ fontFamily: fonts.bold, fontSize: 18, lineHeight: 26, color: colors.ink.DEFAULT }}>{preview.businessName}</Text>
          <Text variant="caption">{t('restore.from', { day: day(preview.createdAt), code: preview.deviceCode })}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {(['invoices', 'products', 'customers', 'suppliers'] as const).map((k) => (
              <View key={k} style={{ flexGrow: 1, minWidth: '45%', padding: 10, borderRadius: 12, backgroundColor: colors.paper.DEFAULT }}>
                <Text variant="caption">{t(`restore.k.${k}`)}</Text>
                <Text style={{ fontFamily: fonts.bold, fontSize: 18, lineHeight: 26, color: colors.ink.DEFAULT }}>{preview.counts[k] ?? 0}</Text>
              </View>
            ))}
          </View>
          {preview.lastInvoice ? <Text variant="caption" style={{ marginTop: 8 }}>{t('restore.lastInvoice', { n: preview.lastInvoice })}</Text> : null}
          <Banner tone="warn" text={t('restore.oldPhone')} />
        </Card>
      ) : null}
    </OnboardingScreen>
  );
}
