/**
 * Ad slot for plans with ads (PLAN.md §18), only in allowed places. Clearly labelled «إعلان» with a way out
 * («شيل الإعلانات — رقّي باقتك»). Shows the AdMob banner when online; when there is no ad (offline, no fill,
 * consent not given) it shows our own upgrade card instead, so the user always understands what the space is.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { Pressable } from '../../ui/Press';
import { Text, Icon, colors, fonts } from '../../ui';
import { useAdSlot } from './ads';
import { adRequestOptions, bannerUnitId } from './backend.native';

const goPlans = () => router.push('/settings/subscription');

/** `inList`: placed inside an already padded list/screen (no extra side margin). */
export function AdBanner({ place, inList }: { place: string; inList?: boolean }) {
  const { t } = useTranslation();
  const { slot, live } = useAdSlot(place);
  const [failed, setFailed] = useState(false);
  if (!slot) return null;
  const showReal = live && !failed;
  return (
    <View style={{ marginHorizontal: inList ? 0 : 16, marginVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.paper.line, backgroundColor: colors.paper.card, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 6, backgroundColor: colors.amber[100] }}>
            <Text style={{ fontFamily: fonts.bold, fontSize: 10.5, color: colors.amber[700] }}>{t('ads.tag')}</Text>
          </View>
          <Text style={{ fontSize: 11, color: colors.ink.mute }}>{t('ads.why')}</Text>
        </View>
      </View>
      {showReal ? (
        <View style={{ alignItems: 'center', minHeight: 50 }}>
          <BannerAd unitId={bannerUnitId()} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER} requestOptions={adRequestOptions()} onAdFailedToLoad={() => setFailed(true)} />
        </View>
      ) : (
        <Pressable onPress={goPlans} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 12, padding: 12, borderRadius: 12, backgroundColor: colors.primary[50] }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary[600] }}>
            <Icon name="shield" size={20} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.bold, fontSize: 13.5, color: colors.ink.DEFAULT }}>{t('ads.houseTitle')}</Text>
            <Text style={{ fontSize: 11.5, color: colors.ink.soft }}>{t('ads.houseBody')}</Text>
          </View>
        </Pressable>
      )}
      <Pressable testID="ads-remove" hitSlop={6} onPress={goPlans} style={{ alignItems: 'center', paddingVertical: 9 }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.primary[700] }}>{t('ads.removeCta')}</Text>
      </Pressable>
    </View>
  );
}
