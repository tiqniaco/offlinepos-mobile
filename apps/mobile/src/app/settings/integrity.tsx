import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { asc } from 'drizzle-orm';
import { Screen, Text, Button, Card, Banner, IconBadge } from '../../ui';
import { getDb } from '../../db/client';
import { verifyChain, type ChainReport } from '../../domain/integrity/chain';
import { verifyAuditRows } from '../../domain/audit/audit';
import { auditLog } from '../../db/schema';
import { useApp } from '../../state/app';

/** Integrity screen (SPEC §6): recompute the document chain and the audit chain. Server anchors: Phase 6. */
export default function Integrity() {
  const { t } = useTranslation();
  const device = useApp((s) => s.device);
  const [doc, setDoc] = useState<ChainReport | null>(null);
  const [audit, setAudit] = useState<ReturnType<typeof verifyAuditRows> | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!device) return;
    setBusy(true);
    const db = getDb();
    setDoc(await verifyChain(db, device.id));
    setAudit(verifyAuditRows(await db.select().from(auditLog).orderBy(asc(auditLog.seq))));
    setBusy(false);
  };
  return (
    <Screen back title={t('integrity.title')}>
      <Card>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <IconBadge name="shield" hue="sky" size={48} />
          <Text variant="body" style={{ flex: 1 }}>
            {t('integrity.body')}
          </Text>
        </View>
      </Card>
      <Button testID="integrity-run" title={t('integrity.run')} loading={busy} onPress={run} />
      {doc ? doc.ok ? <Banner tone="success" text={t('integrity.ok', { n: doc.count })} /> : <Banner tone="danger" text={t('integrity.broken', { number: doc.firstBreak?.number ?? doc.firstBreak?.docType, seq: doc.firstBreak?.seq })} /> : null}
      {audit ? <Banner tone={audit.ok ? 'success' : 'danger'} title={t('integrity.audit')} text={audit.ok ? t('audit.intact') : t('audit.broken', { seq: audit.firstBreakSeq })} /> : null}
    </Screen>
  );
}
