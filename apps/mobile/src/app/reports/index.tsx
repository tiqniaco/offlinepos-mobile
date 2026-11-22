import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { businessDay, roleHas } from '@daftarak/shared';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { dashboard, type Dashboard } from '../../domain/reports/reports';
import { hasFeature } from '../../domain/licence/guard';
import { DashboardView } from '../../features/reports/DashboardView';
import { REPORTS, type ReportDef } from '../../features/reports/defs';
import { useCurrency } from '../../features/inventory/useInvCtx';

export default function Reports() {
  const { t, i18n } = useTranslation();
  const currency = useCurrency();
  const user = useApp((s) => s.user)!;
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const [d, setD] = useState<Dashboard | null>(null);
  useFocusEffect(useCallback(() => void dashboard(getDb(), businessDay(Date.now(), tz)).then(setD), [tz]));
  const visible = REPORTS.filter((r) => roleHas(user.permissions, r.perm));
  const locked = (r: ReportDef) => !!r.feature && !hasFeature(r.feature);
  return (
    <DashboardView
      d={d}
      currency={currency}
      lang={i18n.language}
      showProfit={roleHas(user.permissions, 'profit.view')}
      reports={visible}
      locked={locked}
      onOpen={(r) =>
        locked(r)
          ? Alert.alert(t(`reports.names.${r.id}`), t('licence.feature'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('more.subscription'), onPress: () => router.push('/settings/subscription') }])
          : router.push({ pathname: '/reports/[id]', params: { id: r.id } })
      }
    />
  );
}
