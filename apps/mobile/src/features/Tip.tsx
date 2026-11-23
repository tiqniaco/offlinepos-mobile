/** First-use tip: shown once per screen until dismissed (stored per phone in settings.tipsSeen). */
import { View } from 'react-native';
import { Pressable } from '../ui/Press';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { Text, Icon, colors, fonts } from '../ui';
import { useApp } from '../state/app';
import { getDb } from '../db/client';
import { changeSetting } from '../domain/settings/settings';

export function Tip({ id }: { id: string }) {
  const { t } = useTranslation();
  const seen = useApp((s) => s.settings.tipsSeen ?? []);
  const user = useApp((s) => s.user);
  const device = useApp((s) => s.device);
  if (seen.includes(id) || !user || !device) return null;
  const dismiss = () => {
    const next = [...seen, id];
    useApp.getState().set({ settings: { ...useApp.getState().settings, tipsSeen: next } });
    void changeSetting(getDb(), 'tipsSeen', next, { userId: user.id, deviceId: device.id });
  };
  return (
    <Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.sky[50], borderWidth: 1, borderColor: colors.sky[100] }}>
        <Icon name="info" size={20} color={colors.sky[700]} />
        <Text style={{ flex: 1, color: colors.sky[700], fontFamily: fonts.medium, fontSize: 13.5, lineHeight: 20 }}>{t(`tips.${id}`)}</Text>
        <Pressable testID={`tip-${id}`} hitSlop={10} onPress={dismiss}>
          <Text style={{ color: colors.sky[700], fontFamily: fonts.bold, fontSize: 13, lineHeight: 20 }}>{t('tips.ok')}</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}
