import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import { asc, desc } from 'drizzle-orm';
import { Screen, Text, Banner, colors } from '../../ui';
import { getDb } from '../../db/client';
import { auditLog } from '../../db/schema';
import { verifyAuditRows } from '../../domain/audit/audit';
import { dateTimeLabel } from '../../lib/format';

type Row = typeof auditLog.$inferSelect;

/** Read-only view of the audit log + chain check. There is deliberately no edit or delete. */
export default function Audit() {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);
  const [check, setCheck] = useState<ReturnType<typeof verifyAuditRows> | null>(null);
  useEffect(() => {
    const db = getDb();
    void db.select().from(auditLog).orderBy(desc(auditLog.seq)).limit(200).then(setRows);
    void db.select().from(auditLog).orderBy(asc(auditLog.seq)).then((all) => setCheck(verifyAuditRows(all)));
  }, []);
  return (
    <Screen back title={t('more.audit')} scroll={false}>
      {check ? <Banner tone={check.ok ? 'success' : 'danger'} icon="shield" text={check.ok ? t('audit.intact') : t('audit.broken', { seq: check.firstBreakSeq })} /> : null}
      <View className="flex-1 pt-3">
        <FlashList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={({ item, index }) => (
            <View className="flex-row gap-3">
              <View className="items-center" style={{ width: 20 }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, marginTop: 18, backgroundColor: colors.primary[500], borderWidth: 3, borderColor: colors.primary[100] }} />
                {index < rows.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: colors.paper.line }} /> : null}
              </View>
              <View className="flex-1 border-b py-3" style={{ borderColor: colors.paper.line + '99' }}>
                <Text variant="subtitle">{t(`audit.actions.${item.action.replace('.', '_')}`, { defaultValue: item.action })}</Text>
                <Text variant="caption">
                  {dateTimeLabel(i18n.language, item.at)} · #{item.seq}
                </Text>
              </View>
            </View>
          )}
        />
      </View>
    </Screen>
  );
}
