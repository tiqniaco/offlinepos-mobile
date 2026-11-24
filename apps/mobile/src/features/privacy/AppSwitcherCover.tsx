/**
 * «اخفِ التطبيق في قائمة التطبيقات المفتوحة»: while the app is not in the foreground ('inactive' / 'background') a
 * full-screen cover with the logo is drawn over every screen, so the snapshot iOS keeps for the app switcher shows
 * no numbers. Android's recents preview is hidden by FLAG_SECURE instead («منع تصوير الشاشة»).
 * Not drawn for 'inactive' while one of the phone's own pickers / share sheets is open (state/lockHold.ts).
 */
import { useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, View, type AppStateStatus } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Logo, Text, colors } from '../../ui';
import { useApp } from '../../state/app';
import { isLockHeld } from '../../state/lockHold';
import { coverEnabled, shouldCover } from './coverRules';


export function AppSwitcherCover() {
  const { t } = useTranslation();
  const enabled = useApp((s) => coverEnabled(s.settings.appSwitcherCover));
  const [state, setState] = useState<AppStateStatus>((AppState.currentState as AppStateStatus | null) ?? 'active');
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', setState);
    return () => sub.remove();
  }, []);
  if (!shouldCover(enabled, state, isLockHeld())) return null;
  return (
    <View testID="app-switcher-cover" pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.paper.DEFAULT, alignItems: 'center', justifyContent: 'center', gap: 14, zIndex: 9999, elevation: 9999 }]}>
      <Logo size={96} />
      <Text variant="subtitle">{t('app.name')}</Text>
    </View>
  );
}
