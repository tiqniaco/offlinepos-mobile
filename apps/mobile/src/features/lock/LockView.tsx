import { Pressable, View } from 'react-native';
import { fonts } from '../../ui/fonts';
import { useTranslation } from 'react-i18next';
import { Text, Hero, Avatar, PinDots, PinPad, Button, Logo, shadow, colors } from '../../ui';

export interface LockUser {
  id: string;
  name: string;
  color: string;
  roleName: string;
  biometricEnabled: boolean;
}

/** Pure view (no DB) so it can be previewed in the dev gallery. Container: src/app/lock.tsx */
export function LockView({
  businessName,
  users,
  selected,
  pin,
  message,
  busy,
  bioAvailable,
  onSelect,
  onPin,
  onSubmit,
  onBiometric,
}: {
  businessName: string;
  users: LockUser[];
  selected: LockUser | null;
  pin: string;
  message: string | null;
  busy: boolean;
  bioAvailable: boolean;
  onSelect: (u: LockUser | null) => void;
  onPin: (v: string) => void;
  onSubmit: () => void;
  onBiometric: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-1 bg-paper">
      <Hero>
        <View className="items-center gap-3 px-6 pb-6 pt-6">
          <View className="flex-row items-center gap-2" style={{ backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5 }}>
            <Logo size={20} bare />
            <Text style={{ color: '#FFFFFF', fontSize: 13, lineHeight: 20, fontFamily: fonts.semibold }}>{businessName}</Text>
          </View>
          {selected ? (
            <>
              <Avatar name={selected.name} color={selected.color} size={78} ring />
              <View className="items-center">
                <Text style={{ color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 22, lineHeight: 32 }}>{selected.name}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 20, fontFamily: fonts.medium }}>{selected.roleName}</Text>
              </View>
              <View className="h-6 justify-center">
                <PinDots count={pin.length} total={Math.max(4, pin.length)} error={!!message} light />
              </View>
              <Text style={{ color: message ? '#FFD9D4' : 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 22, fontFamily: fonts.medium }}>{message ?? t('lock.enterPin')}</Text>
            </>
          ) : (
            <View className="items-center gap-1 py-4">
              <Text style={{ color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 26, lineHeight: 38 }}>{t('lock.welcomeBack')}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15, lineHeight: 24, fontFamily: fonts.medium }}>{t('lock.chooseUser')}</Text>
            </View>
          )}
        </View>
      </Hero>

      {!selected ? (
        <View className="flex-row flex-wrap justify-center gap-4 px-5 pt-4">
          {users.map((u) => (
            <Pressable
              key={u.id}
              testID={`user-${u.name}`}
              onPress={() => onSelect(u)}
              style={({ pressed }) => [{ width: 140, alignItems: 'center', gap: 8, paddingVertical: 18, borderRadius: 22, backgroundColor: colors.paper.card, opacity: pressed ? 0.85 : 1 }, shadow.soft]}
            >
              <Avatar name={u.name} color={u.color} size={60} />
              <View className="items-center">
                <Text style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: colors.ink.DEFAULT }}>{u.name}</Text>
                <Text variant="caption">{u.roleName}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : (
        <View className="flex-1 items-center justify-between px-6 pb-6 pt-4">
          <PinPad value={pin} onChange={onPin} maxLength={6} disabled={busy} onBiometric={selected.biometricEnabled && bioAvailable ? onBiometric : undefined} />
          <View className="w-full max-w-[300px] flex-row gap-3 pt-4">
            {users.length > 1 ? (
              <View className="flex-1">
                <Button kind="secondary" compact title={t('lock.switchUser')} onPress={() => onSelect(null)} />
              </View>
            ) : null}
            <View className="flex-1">
              <Button testID="pin-ok" compact title={t('common.done')} loading={busy} disabled={pin.length < 4} onPress={onSubmit} />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
