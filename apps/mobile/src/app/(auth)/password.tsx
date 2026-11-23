import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { passwordProblem } from '@daftarak/shared';
import { OnboardingScreen, Button, PasswordField, Banner, Card, Text, Icon, colors } from '../../ui';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { useOnboarding } from '../../state/app';

/** After the SMS code: choose the account password (new account) or a new one (forgot password). */
export default function ChoosePassword() {
  const { t } = useTranslation();
  const auth = useOnboarding((s) => s.auth);
  const reset = useOnboarding((s) => s.mode === 'reset' || !!s.auth?.account.hasPassword);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!auth) return null;

  const rules = [
    { ok: pw.length >= 8, label: t('password.ruleLength') },
    { ok: /\p{L}/u.test(pw), label: t('password.ruleLetter') },
    { ok: /[0-9٠-٩]/.test(pw), label: t('password.ruleDigit') },
  ];

  const submit = async () => {
    const p = passwordProblem(pw);
    if (p) return setError(t(`password.problem.${p}`));
    if (pw !== pw2) return setError(t('owner.mismatch'));
    setError(null);
    setBusy(true);
    try {
      await api.setPassword(auth.accessToken, pw);
      useOnboarding.getState().set({ password: pw, auth: { ...auth, account: { ...auth.account, hasPassword: true } } });
      router.replace(auth.businesses.length > 0 ? '/choose-business' : '/business');
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingScreen
      title={reset ? t('password.newTitle') : t('password.title')}
      subtitle={reset ? t('password.newBody') : t('password.body')}
      footer={<Button testID="password-save" title={t('password.save')} loading={busy} onPress={() => void submit()} />}
    >
      <PasswordField testID="password-1" label={t('login.password')} value={pw} onChangeText={setPw} autoFocus />
      <PasswordField testID="password-2" label={t('password.confirm')} value={pw2} onChangeText={setPw2} onSubmitEditing={() => void submit()} />
      <Card>
        <View className="gap-1.5">
          {rules.map((r) => (
            <View key={r.label} className="flex-row items-center gap-2">
              <Icon name={r.ok ? 'check' : 'info'} size={14} color={r.ok ? colors.leaf[600] : colors.ink.faint} />
              <Text variant="caption" style={{ color: r.ok ? colors.leaf[700] : colors.ink.soft }}>
                {r.label}
              </Text>
            </View>
          ))}
        </View>
      </Card>
      {reset ? <Banner tone="info" icon="shield" text={t('password.otherPhones')} /> : null}
      {error ? <Banner tone="danger" text={error} /> : null}
    </OnboardingScreen>
  );
}
