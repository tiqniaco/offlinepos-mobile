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
import { verifyAnchors, type AnchorReport } from '../../domain/integrity/anchors';
import { dateTimeLabel } from '../../lib/format';

/** Integrity screen (SPEC §6): document chain, audit chain, and the server-signed daily anchors. */
export default function Integrity() {
  const { t, i18n } = useTranslation();
  const [anchors, setAnchors] = useState<AnchorReport | null>(null);
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
    setAnchors(await verifyAnchors(db, device.id));
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
      {anchors ? (
        anchors.mismatch ? (
          <Banner tone="danger" title={t('integrity.anchorsTitle')} text={t('integrity.anchorBroken', { at: dateTimeLabel(i18n.language, anchors.mismatch.serverTime), seq: anchors.mismatch.chainSeq })} />
        ) : (
          <Banner tone={anchors.anchors ? 'success' : 'info'} title={t('integrity.anchorsTitle')} text={anchors.anchors ? t('integrity.anchorsOk', { n: anchors.anchors, at: anchors.lastAnchorAt ? dateTimeLabel(i18n.language, anchors.lastAnchorAt) : '' }) : t('integrity.noAnchors')} />
        )
      ) : null}
      {audit ? <Banner tone={audit.ok ? 'success' : 'danger'} title={t('integrity.audit')} text={audit.ok ? t('audit.intact') : t('audit.broken', { seq: audit.firstBreakSeq })} /> : null}
    </Screen>
  );
}
