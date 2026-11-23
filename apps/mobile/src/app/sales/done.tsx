import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Button, IconBadge, Card, colors, fonts } from '../../ui';
import { getDb } from '../../db/client';
import { getSale } from '../../domain/sales/sales';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { money } from '../../lib/format';
import { printReceipt, sharePdf, whatsappInvoice } from '../../features/printing/actions';

/** After payment: change to give, print / WhatsApp PDF, new sale — all one tap. */
export default function Done() {
  const { t, i18n } = useTranslation();
  const { id, change } = useLocalSearchParams<{ id: string; change?: string }>();
  const currency = useCurrency();
  const [sale, setSale] = useState<Awaited<ReturnType<typeof getSale>>>(null);
  const [printing, setPrinting] = useState(false);
  const [sharing, setSharing] = useState<null | 'whatsapp' | 'pdf'>(null);
  useEffect(() => {
    let alive = true;
    void getSale(getDb(), id).then(
      (s) => alive && setSale(s),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [id]);
  const share = async (kind: 'whatsapp' | 'pdf') => {
    if (sharing) return;
    setSharing(kind);
    try {
      await (kind === 'pdf' ? sharePdf(id) : whatsappInvoice(id));
    } finally {
      setSharing(null);
    }
  };
  const ch = Number(change ?? 0);
  return (
    <Screen footer={<Button testID="done-new" icon="plus" title={t('done.newSale')} onPress={() => router.dismissTo('/sales/pos')} />}>
      <View style={{ alignItems: 'center', gap: 10, paddingTop: 24 }}>
        <IconBadge name="check" hue="leaf" size={72} />
        <Text style={{ fontFamily: fonts.bold, fontSize: 26, lineHeight: 36, color: colors.ink.DEFAULT }}>{t('done.title')}</Text>
        {sale ? <Text variant="caption">{sale.doc.number}</Text> : null}
        {sale ? <Text style={{ fontFamily: fonts.bold, fontSize: 22, lineHeight: 30, color: colors.primary[700] }}>{money(sale.doc.totalMinor, currency, i18n.language)}</Text> : null}
      </View>
      {ch > 0 ? (
        <Card>
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Text variant="label">{t('done.change')}</Text>
            <Text testID="done-change" style={{ fontFamily: fonts.bold, fontSize: 40, lineHeight: 54, color: colors.leaf[700] }}>{money(ch, currency, i18n.language)}</Text>
          </View>
        </Card>
      ) : null}
      <Button
        kind="secondary"
        icon="clipboard"
        title={printing ? t('done.printing') : t('done.print')}
        loading={printing}
        onPress={async () => {
          if (printing) return;
          setPrinting(true);
          try {
            await printReceipt(id);
          } finally {
            setPrinting(false);
          }
        }}
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button kind="secondary" compact icon="whatsapp" title={t('share.whatsapp')} loading={sharing === 'whatsapp'} disabled={!!sharing} onPress={() => void share('whatsapp')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button kind="secondary" compact icon="file" title="PDF" loading={sharing === 'pdf'} disabled={!!sharing} onPress={() => void share('pdf')} />
        </View>
      </View>
    </Screen>
  );
}
