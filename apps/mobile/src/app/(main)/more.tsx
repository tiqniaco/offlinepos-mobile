import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { roleHas } from '@daftarak/shared';
import { Screen, ListRow, ListGroup, Text } from '../../ui';
import { useApp } from '../../state/app';
import { APP_VERSION } from '../../config/env';

export default function More() {
  const { t } = useTranslation();
  const user = useApp((s) => s.user);
  const device = useApp((s) => s.device);
  const lang = useApp((s) => s.settings.language ?? 'ar');
  const can = (p: Parameters<typeof roleHas>[1]) => !!user && roleHas(user.permissions, p);
  return (
    <Screen title={t('more.title')}>
      <ListGroup>
        {can('users.manage') ? <ListRow testID="more-users" icon="users" title={t('more.users')} onPress={() => router.push('/settings/users')} /> : null}
        <ListRow testID="more-security" icon="lock" title={t('more.security')} onPress={() => router.push('/settings/security')} />
        <ListRow icon="globe" title={t('more.language')} value={t(`language.${lang}`)} onPress={() => router.push('/settings/language')} />
        {can('subscription.manage') ? <ListRow icon="card" title={t('more.subscription')} onPress={() => router.push('/settings/subscription')} /> : null}
        {can('settings.manage') ? <ListRow icon="list" title={t('more.audit')} onPress={() => router.push('/settings/audit')} /> : null}
      </ListGroup>
      <ListGroup>
        <ListRow testID="lock-now" icon="lock" title={t('more.lockNow')} onPress={() => useApp.getState().lock()} />
      </ListGroup>
      <Text variant="caption" className="text-center">
        {t('app.name')} {APP_VERSION} · {device?.code}
      </Text>
    </Screen>
  );
}
