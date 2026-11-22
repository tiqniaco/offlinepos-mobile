import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Button, Card, Banner, IconBadge } from '../../ui';
import { View } from 'react-native';
import { getDb } from '../../db/client';
import { checkStockLevels, rebuildStockLevels, type RebuildDiff } from '../../domain/inventory/ledger';
import { appendAudit } from '../../domain/audit/audit';
import { withTx } from '../../db/tx';
import { useApp } from '../../state/app';
import { toast } from '../../state/toast';

/** Verifies cached balances against the append-only ledger and repairs them (PLAN.md §6 rule 8). */
export default function StockCheck() {
  const { t } = useTranslation();
  const user = useApp((s) => s.user);
  const device = useApp((s) => s.device);
  const [diffs, setDiffs] = useState<RebuildDiff[] | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Screen back title={t('check.title')}>
      <Card>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <IconBadge name="refresh" hue="sky" size={48} />
          <Text variant="body" style={{ flex: 1 }}>
            {t('check.body')}
          </Text>
        </View>
      </Card>
      <Button
        title={t('check.run')}
        loading={busy}
        onPress={async () => {
          setBusy(true);
          setDiffs(await checkStockLevels(getDb()));
          setBusy(false);
        }}
      />
      {diffs ? diffs.length === 0 ? <Banner tone="success" text={t('check.ok')} /> : <Banner tone="warn" text={t('check.diffs', { n: diffs.length })} /> : null}
      {diffs && diffs.length > 0 ? (
        <Button
          kind="secondary"
          title={t('check.repair')}
          onPress={async () => {
            const before = await rebuildStockLevels(getDb());
            if (user && device) await withTx(getDb(), (tx) => appendAudit(tx, { action: 'stock.rebuild', entity: 'stock_levels', after: { fixed: before.length }, userId: user.id, deviceId: device.id }));
            setDiffs([]);
            toast(t('check.repaired'));
          }}
        />
      ) : null}
    </Screen>
  );
}
