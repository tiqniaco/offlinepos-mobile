import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { router } from 'expo-router';
import { Pressable } from '../../ui/Press';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { uuidv7 } from '@daftarak/shared';
import { Screen, Text, Button, Card, TextField, Icon, ListRow, colors } from '../../ui';
import { getDb } from '../../db/client';
import { withTx } from '../../db/tx';
import { business } from '../../db/schema';
import { appendAudit } from '../../domain/audit/audit';
import { requirePermission } from '../../domain/auth/users';
import { reloadAppData } from '../../state/boot';
import { useApp } from '../../state/app';
import { toast } from '../../state/toast';
import { saveProductImage } from '../../features/inventory/images';
import { errorMessage } from '../../lib/errors';
import { withLockHold } from '../../state/lockHold';

/** Shop details printed on every receipt / invoice (logo, address, phones). The look lives in ./templates. */
export default function ReceiptSettings() {
  const { t } = useTranslation();
  const user = useApp((s) => s.user)!;
  const device = useApp((s) => s.device)!;
  const [address, setAddress] = useState('');
  const [phones, setPhones] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    void getDb()
      .select()
      .from(business)
      .limit(1)
      .then(([b]) => {
        if (!b) return;
        setAddress(b.address ?? '');
        setPhones((JSON.parse(b.phonesJson) as string[]).join(' , '));
        setLogo(b.logoPath);
      });
  }, []);
  const save = async () => {
    try {
      requirePermission(user, 'settings.manage');
      const db = getDb();
      await withTx(db, async (tx) => {
        const [b] = await tx.select().from(business).limit(1);
        const next = { address: address.trim() || null, phonesJson: JSON.stringify(phones.split(/[,،\n]/).map((p) => p.trim()).filter(Boolean)), logoPath: logo, updatedAt: Date.now() };
        await tx.update(business).set(next);
        await appendAudit(tx, { action: 'settings.change', entity: 'business', entityId: b?.id, before: { address: b?.address, phones: b?.phonesJson }, after: next, userId: user.id, deviceId: device.id });
      });
      await reloadAppData();
      toast(t('productForm.saved'));
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    }
  };
  return (
    <Screen back title={t('templates.shopDetails')} footer={<Button title={t('common.save')} onPress={save} />}>
      <Card padded={false}>
        <ListRow icon="receipt" hue="primary" title={t('templates.title')} subtitle={t('templates.subtitle')} last onPress={() => router.push('/settings/templates')} />
      </Card>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Pressable
            onPress={async () => {
              try {
                const r = await withLockHold(() => ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 }));
                if (!r.canceled && r.assets[0]) setLogo(await saveProductImage(r.assets[0].uri, `logo-${uuidv7()}`));
              } catch (e) {
                toast(errorMessage(t, e), 'error');
              }
            }}
            style={{ width: 84, height: 84, borderRadius: 20, backgroundColor: colors.paper.sunk, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
          >
            {logo ? <Image source={{ uri: logo }} style={{ width: 84, height: 84 }} resizeMode="contain" /> : <Icon name="image" color={colors.ink.faint} size={30} />}
          </Pressable>
          <Text variant="subtitle" style={{ flex: 1 }}>
            {t('printers.logo')}
          </Text>
        </View>
      </Card>
      <TextField label={t('printers.address')} value={address} onChangeText={setAddress} latinDigits={false} />
      <TextField label={t('printers.phones')} value={phones} onChangeText={setPhones} keyboardType="phone-pad" ltr />
    </Screen>
  );
}
