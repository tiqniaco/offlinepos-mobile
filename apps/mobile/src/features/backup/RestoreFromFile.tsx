import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ObkError, PortableError } from '@daftarak/shared';
import { Text, Button, Card, Banner, IconBadge, PasswordField, colors, fonts } from '../../ui';
import { fx } from '../../ui/fx';
import { useApp, useOnboarding } from '../../state/app';
import { boot } from '../../state/boot';
import { toast } from '../../state/toast';
import { dateTimeLabel } from '../../lib/format';
import { applyPortable, discardPortable, pickPortableFile, portableTarget, stagePortable, type PortablePick, type PortablePreview, type PortableStage } from './portable';
import type { PortableRestoreMode } from '../../domain/backup/portable';
import type { Approval } from '../../domain/auth/approval';
import { useApprovalGate } from '../approval/useApprovalGate';
import { currentActor } from '../approval/exportGate';

type Step = 'pick' | 'pass' | 'working' | 'preview' | 'installing';
export type ShellProps = { footer: ReactNode; children: ReactNode };

/** Short, growing pause after a wrong passphrase (offline there is no server-side limit). */
const pauseAfter = (fails: number) => Math.min(2_000 * fails, 10_000);

/**
 * Restore a ".kashiro" file without our server. `inApp`: started from Settings on an existing (empty) shop;
 * otherwise from the welcome / sign-in screens of a fresh install.
 */
export function RestoreFromFile({ inApp, Shell }: { inApp: boolean; Shell: (p: ShellProps) => ReactNode }): ReactNode {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState<Step>('pick');
  const [pick, setPick] = useState<PortablePick | null>(null);
  const [pass, setPass] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ p: number; stage: PortableStage }>({ p: 0, stage: 'key' });
  const [preview, setPreview] = useState<PortablePreview | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [mode, setMode] = useState<'offline' | 'keep'>('offline');
  const [waitUntil, setWaitUntil] = useState(0);
  const [, tick] = useState(0);
  const fails = useRef(0);

  useEffect(() => () => discardPortable(), []);
  useEffect(() => {
    if (waitUntil <= Date.now()) return;
    const id = setInterval(() => (Date.now() >= waitUntil ? (clearInterval(id), tick((n) => n + 1)) : tick((n) => n + 1)), 500);
    return () => clearInterval(id);
  }, [waitUntil]);
  const waitS = Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000));

  // Wrong passphrase / damaged file / tampered header: a clear sentence, never a crash.
  const why = (e: unknown) => (e instanceof PortableError ? t(`portable.errors.${e.code}`) : e instanceof ObkError ? t('portable.errors.damaged') : t('portable.errors.unreadable'));

  const choose = async () => {
    setErr(null);
    try {
      const p = await pickPortableFile();
      if (!p) return;
      setPick(p);
      setPass('');
      setStep('pass');
    } catch (e) {
      setErr(why(e));
    }
  };

  const open = async () => {
    if (!pick || !pass || waitS > 0) return;
    setErr(null);
    setStep('working');
    try {
      const pv = await stagePortable(pick, pass, (p, stage) => setProgress({ p, stage }));
      fails.current = 0;
      const target = await portableTarget();
      setBlocked(target.ok ? null : t(`portable.errors.${target.reason}`));
      if (target.ok) setMode(target.mode.kind);
      setPreview(pv);
      setStep('preview');
    } catch (e) {
      if (e instanceof PortableError && e.code === 'passphrase') {
        fails.current += 1;
        setWaitUntil(Date.now() + pauseAfter(fails.current));
        setPass('');
      }
      fx.error();
      setErr(why(e));
      setStep(e instanceof PortableError && e.code === 'passphrase' ? 'pass' : 'pick');
    }
  };

  const gate = useApprovalGate();
  const install = async () => {
    setErr(null);
    const target = await portableTarget();
    if (!target.ok) {
      setBlocked(t(`portable.errors.${target.reason}`));
      return;
    }
    // Existing shop: «تأكيد المدير» first (the restore checks it again before touching the database).
    if (inApp) gate.run('restore', (a) => apply(target.mode, a));
    else await apply(target.mode, null);
  };
  const apply = async (mode: PortableRestoreMode, approval: Approval | null) => {
    const actor = inApp ? currentActor() : null;
    setStep('installing');
    // In the app, unmount every screen before the database file is swapped.
    if (inApp) useApp.getState().set({ status: 'booting', user: null });
    let ok = false;
    try {
      await applyPortable(mode, { actor, approvedBy: approval });
      ok = true;
      fx.success();
      if (!inApp) useOnboarding.getState().reset();
    } catch {
      toast(t('portable.errors.installFailed'), 'error');
      if (!inApp) {
        setErr(t('portable.errors.installFailed'));
        setStep('pick');
      }
    } finally {
      // Reopens the database (restored or, after a failure, whatever is there) → lock screen with the restored users.
      await boot().catch(() => undefined);
    }
  };

  const footer =
    step === 'pick' ? (
      <Button testID="portable-pick" icon="file" title={t('portable.pick')} onPress={() => void choose()} />
    ) : step === 'pass' ? (
      <>
        <Button testID="portable-open" icon="lock" title={waitS > 0 ? t('portable.wait', { s: waitS }) : t('portable.open')} disabled={!pass || waitS > 0} onPress={() => void open()} />
        <Button kind="ghost" title={t('portable.otherFile')} onPress={() => (setStep('pick'), setErr(null))} />
      </>
    ) : step === 'preview' ? (
      blocked ? (
        <Button kind="secondary" title={t('portable.otherFile')} onPress={() => (discardPortable(), setStep('pick'), setBlocked(null))} />
      ) : (
        <Button testID="portable-confirm" icon="check" title={t('portable.confirm')} onPress={() => void install()} />
      )
    ) : null;

  // Shell is called as a function (not <Shell>): a new component type each render would remount the form.
  return Shell({
    footer,
    children: (
    <>
      {err ? <Banner tone="danger" text={err} /> : null}
      {step === 'pick' ? (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <IconBadge name="cloudOff" hue="primary" size={44} />
              <Text variant="body" style={{ flex: 1 }}>{t('portable.pickHint')}</Text>
            </View>
          </Card>
          {inApp ? <Banner tone="warn" text={t('portable.inAppHint')} /> : <Banner tone="info" text={t('portable.offlineNote')} />}
        </>
      ) : null}
      {step === 'pass' && pick ? (
        <>
          <Card>
            <Text style={{ fontFamily: fonts.bold, fontSize: 17, lineHeight: 25, color: colors.ink.DEFAULT }}>{pick.header.businessName}</Text>
            <Text variant="caption">{t('portable.fileFrom', { day: dateTimeLabel(i18n.language, pick.header.createdAt) })}</Text>
            <Text variant="caption">{pick.fileName}</Text>
          </Card>
          <PasswordField testID="portable-pass" label={t('portable.enterPass')} value={pass} onChangeText={setPass} onSubmitEditing={() => void open()} autoFocus />
        </>
      ) : null}
      {step === 'working' || step === 'installing' ? (
        <Card>
          <Text variant="subtitle">{step === 'installing' ? t('restore.installing') : progress.stage === 'key' ? t('portable.unlocking') : t('restore.decrypting')}</Text>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.paper.sunk, marginTop: 10, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round((step === 'installing' ? 1 : progress.p) * 100)}%`, height: 8, backgroundColor: colors.primary[500] }} />
          </View>
          <Text variant="caption" style={{ marginTop: 6 }}>{t('restore.keepOpen')}</Text>
        </Card>
      ) : null}
      {step === 'preview' && preview ? (
        <>
          <Card>
            <Text style={{ fontFamily: fonts.bold, fontSize: 18, lineHeight: 26, color: colors.ink.DEFAULT }}>{preview.businessName}</Text>
            <Text variant="caption">{t('portable.fileFrom', { day: dateTimeLabel(i18n.language, preview.createdAt) })}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {(['invoices', 'products', 'customers', 'suppliers'] as const).map((k) => (
                <View key={k} style={{ flexGrow: 1, minWidth: '45%', padding: 10, borderRadius: 12, backgroundColor: colors.paper.DEFAULT }}>
                  <Text variant="caption">{t(`restore.k.${k}`)}</Text>
                  <Text style={{ fontFamily: fonts.bold, fontSize: 18, lineHeight: 26, color: colors.ink.DEFAULT }}>{preview.counts[k] ?? 0}</Text>
                </View>
              ))}
            </View>
            {preview.lastInvoice ? <Text variant="caption" style={{ marginTop: 8 }}>{t('restore.lastInvoice', { n: preview.lastInvoice })}</Text> : null}
          </Card>
          {blocked ? <Banner tone="danger" text={blocked} /> : <Banner tone={mode === 'keep' ? 'success' : 'warn'} text={mode === 'keep' ? t('portable.keepNote') : t('portable.offlineNote')} />}
        </>
      ) : null}
      {inApp ? gate.sheet : null}
    </>
    ),
  });
}
