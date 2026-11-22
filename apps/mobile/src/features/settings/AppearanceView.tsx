import { Pressable, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Screen, Text, SectionTitle, Icon, PALETTES, buildTheme, colors, shadow, type PaletteId, type Appearance } from '../../ui';

const MODES: { id: Appearance; icon: 'globe' | 'shield' | 'book' | 'refresh' }[] = [
  { id: 'light', icon: 'globe' },
  { id: 'dark', icon: 'shield' },
  { id: 'comfort', icon: 'book' },
  { id: 'system', icon: 'refresh' },
];

/** Mini screen drawn with a given theme — so each option previews itself, whatever the current theme is. */
function MiniPreview({ palette, mode }: { palette: PaletteId; mode: Exclude<Appearance, 'system'> }) {
  const t = buildTheme(palette, mode);
  return (
    <View style={{ borderRadius: 14, overflow: 'hidden', backgroundColor: t.paper.DEFAULT, borderWidth: 1, borderColor: t.paper.line }}>
      <LinearGradient colors={t.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 34, paddingHorizontal: 8, justifyContent: 'center' }}>
        <View style={{ width: 40, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.85)' }} />
      </LinearGradient>
      <View style={{ padding: 8, gap: 6 }}>
        <View style={{ backgroundColor: t.paper.card, borderRadius: 8, padding: 6, gap: 4 }}>
          <View style={{ width: '70%', height: 5, borderRadius: 3, backgroundColor: t.ink.DEFAULT }} />
          <View style={{ width: '45%', height: 5, borderRadius: 3, backgroundColor: t.ink.faint }} />
        </View>
        <View style={{ height: 14, borderRadius: 7, backgroundColor: t.primary['600'] }} />
      </View>
    </View>
  );
}

export function AppearanceView({ palette, appearance, onPalette, onAppearance, lang }: { palette: PaletteId; appearance: Appearance; onPalette: (p: PaletteId) => void; onAppearance: (a: Appearance) => void; lang: string }) {
  const { t } = useTranslation();
  const previewMode: Exclude<Appearance, 'system'> = appearance === 'system' ? (colors.isDark ? 'dark' : 'light') : appearance;
  return (
    <Screen back title={t('appearance.title')}>
      <SectionTitle>{t('appearance.palette')}</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {PALETTES.map((p) => {
          const on = p.id === palette;
          return (
            <Pressable
              key={p.id}
              testID={`palette-${p.id}`}
              onPress={() => onPalette(p.id)}
              style={({ pressed }) => [
                { width: '31%', padding: 8, gap: 8, borderRadius: 18, backgroundColor: colors.paper.card, borderWidth: 2, borderColor: on ? colors.primary[500] : 'transparent', opacity: pressed ? 0.85 : 1 },
                shadow.soft,
              ]}
            >
              <MiniPreview palette={p.id} mode={previewMode} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: 14, lineHeight: 20, color: colors.ink.DEFAULT }}>{lang === 'en' ? p.nameEn : p.nameAr}</Text>
                {on ? (
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary[600], alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="check" size={12} color="#FFFFFF" />
                  </View>
                ) : null}
              </View>
              {p.id === 'tiqnia' ? <Text variant="caption">{t('appearance.default')}</Text> : null}
            </Pressable>
          );
        })}
      </View>

      <SectionTitle>{t('appearance.mode')}</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {MODES.map((m) => {
          const on = m.id === appearance;
          const pm: Exclude<Appearance, 'system'> = m.id === 'system' ? 'light' : m.id;
          return (
            <Pressable
              key={m.id}
              testID={`mode-${m.id}`}
              onPress={() => onAppearance(m.id)}
              style={({ pressed }) => [
                { width: '48%', padding: 10, gap: 8, borderRadius: 18, backgroundColor: colors.paper.card, borderWidth: 2, borderColor: on ? colors.primary[500] : 'transparent', opacity: pressed ? 0.85 : 1 },
                shadow.soft,
              ]}
            >
              {m.id === 'system' ? (
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <View style={{ flex: 1 }}>
                    <MiniPreview palette={palette} mode="light" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MiniPreview palette={palette} mode="dark" />
                  </View>
                </View>
              ) : (
                <MiniPreview palette={palette} mode={pm} />
              )}
              <View>
                <Text style={{ fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: 15, lineHeight: 22, color: on ? colors.primary[700] : colors.ink.DEFAULT }}>{t(`appearance.${m.id}`)}</Text>
                <Text variant="caption">{t(`appearance.${m.id}Hint`)}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
