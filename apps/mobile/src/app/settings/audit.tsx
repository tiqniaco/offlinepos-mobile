import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import { asc, desc } from 'drizzle-orm';
import { Screen, Text, Banner, colors } from '../../ui';
import { getDb } from '../../db/client';
import { auditLog } from '../../db/schema';
import { verifyAuditRowsChunked, type ChainCheck } from '../../domain/audit/audit';
import { errorMessage } from '../../lib/errors';
import { dateTimeLabel } from '../../lib/format';

type Row = typeof auditLog.$inferSelect;

/** Read-only view of the audit log + chain check. There is deliberately no edit or delete. */
export default function Audit() {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);
  const [check, setCheck] = useState<ChainCheck | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // Start after the screen transition; the chain check yields to the UI between chunks.
    const id = setTimeout(() => {
      void (async () => {
        try {
          const db = getDb();
          const recent = await db.select().from(auditLog).orderBy(desc(auditLog.seq)).limit(200);
          if (alive) setRows(recent);
          const all = await db.select().from(auditLog).orderBy(asc(auditLog.seq));
          const r = await verifyAuditRowsChunked(all);
          if (alive) setCheck(r);
        } catch (e) {
          if (alive) setErr(errorMessage(t, e));
        }
      })();
    }, 220);
    return () => {
      alive = false;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Screen back title={t('more.audit')} scroll={false}>
      {err ? <Banner tone="danger" text={err} /> : null}
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
