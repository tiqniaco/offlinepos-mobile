import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import { asc, desc } from 'drizzle-orm';
import { Screen, Text, Banner } from '../../ui';
import { getDb } from '../../db/client';
import { auditLog } from '../../db/schema';
import { verifyAuditRows } from '../../domain/audit/audit';

type Row = typeof auditLog.$inferSelect;

/** Read-only view of the audit log + chain check. There is deliberately no edit or delete. */
export default function Audit() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);
  const [check, setCheck] = useState<ReturnType<typeof verifyAuditRows> | null>(null);
  useEffect(() => {
    const db = getDb();
    void db.select().from(auditLog).orderBy(desc(auditLog.seq)).limit(200).then(setRows);
    void db.select().from(auditLog).orderBy(asc(auditLog.seq)).then((all) => setCheck(verifyAuditRows(all)));
  }, []);
  return (
    <Screen back title={t('more.audit')} scroll={false}>
      {check ? <Banner tone={check.ok ? 'success' : 'danger'} text={check.ok ? t('audit.intact') : t('audit.broken', { seq: check.firstBreakSeq })} /> : null}
      <FlashList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => (
          <View className="border-b border-paper-line/60 py-3">
            <Text variant="subtitle">{t(`audit.actions.${item.action.replace('.', '_')}`, { defaultValue: item.action })}</Text>
            <Text variant="caption">
              {new Date(item.at).toLocaleString(undefined, { hour12: true })} · #{item.seq}
            </Text>
          </View>
        )}
      />
    </Screen>
  );
}
