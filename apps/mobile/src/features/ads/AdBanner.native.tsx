/**
 * Anchored adaptive banner for allowed places only (PLAN.md §18). Renders nothing for paid plans, offline,
 * or in a place that is not on the allow-list — no empty box, nothing blocks work. Small "remove ads" link.
 */
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { Text, colors, fonts } from '../../ui';
import { useBannerAllowed } from './ads';
import { adRequestOptions, bannerUnitId } from './backend.native';

export function AdBanner({ place }: { place: string }) {
  const { t } = useTranslation();
  const allowed = useBannerAllowed(place);
  if (!allowed) return null;
  return (
    <View style={{ alignItems: 'center', gap: 2, paddingVertical: 4, backgroundColor: colors.paper.DEFAULT }}>
      <BannerAd unitId={bannerUnitId()} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER} requestOptions={adRequestOptions()} />
      <Pressable hitSlop={8} onPress={() => router.push('/settings/subscription')}>
        <Text style={{ fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.primary[700] }}>{t('ads.remove')}</Text>
      </Pressable>
    </View>
  );
}
