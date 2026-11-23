import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { Pressable } from '../../ui/Press';
import { fonts } from '../../ui/fonts';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { playSound, type SoundVolume } from '../../ui/sounds';
import { Screen, Text, SectionTitle, Icon, Chip, PALETTES, FONT_FAMILIES, preloadAllFonts, buildTheme, colors, shadow, type PaletteId, type Appearance, type FontId, type TextSize } from '../../ui';

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

export function AppearanceView({
  palette,
  appearance,
  font,
  textSize = 'md',
  onTextSize,
  sounds = true,
  onSounds,
  soundVolume = 'medium',
  onSoundVolume,
  haptics = true,
  onHaptics,
  notifications = true,
  onNotifications,
  onPalette,
  onAppearance,
  onFont,
  lang,
}: {
  palette: PaletteId;
  appearance: Appearance;
  font: FontId;
  textSize?: TextSize;
  onTextSize?: (z: TextSize) => void;
  sounds?: boolean;
  onSounds?: (on: boolean) => void;
  soundVolume?: SoundVolume;
  onSoundVolume?: (v: SoundVolume) => void;
  haptics?: boolean;
  onHaptics?: (on: boolean) => void;
  notifications?: boolean;
  onNotifications?: (on: boolean) => void;
  onPalette: (p: PaletteId) => void;
  onAppearance: (a: Appearance) => void;
  onFont: (f: FontId) => void;
  lang: string;
}) {
  const { t } = useTranslation();
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    void preloadAllFonts().then(() => setFontsReady(true), () => setFontsReady(true));
  }, []);
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
                <Text style={{ fontFamily: fonts.bold, fontSize: 14, lineHeight: 20, color: colors.ink.DEFAULT }}>{lang === 'en' ? p.nameEn : p.nameAr}</Text>
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
                <Text style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: on ? colors.primary[700] : colors.ink.DEFAULT }}>{t(`appearance.${m.id}`)}</Text>
                <Text variant="caption">{t(`appearance.${m.id}Hint`)}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <SectionTitle>{t('appearance.sounds')}</SectionTitle>
      <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.paper.card }, shadow.soft]}>
        <View style={{ flex: 1 }}>
          <Text variant="subtitle">{t('appearance.soundsOn')}</Text>
          <Text variant="caption">{t('appearance.soundsHint')}</Text>
        </View>
        <Chip label={t('appearance.soundTry')} onPress={() => { playSound('scan'); setTimeout(() => playSound('add'), 260); setTimeout(() => playSound('sale'), 600); }} />
        <Switch testID="sounds-switch" value={sounds} onValueChange={(v) => onSounds?.(v)} trackColor={{ true: colors.primary[500], false: colors.paper.line }} />
      </View>
      {sounds ? (
        <View style={[{ gap: 8, padding: 14, borderRadius: 16, backgroundColor: colors.paper.card }, shadow.soft]}>
          <Text variant="subtitle">{t('appearance.soundVolume')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['low', 'medium', 'high'] as const).map((v) => (
              <Chip key={v} testID={`volume-${v}`} label={t(`appearance.volume.${v}`)} selected={soundVolume === v} onPress={() => onSoundVolume?.(v)} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.paper.card }, shadow.soft]}>
        <View style={{ flex: 1 }}>
          <Text variant="subtitle">{t('appearance.hapticsOn')}</Text>
          <Text variant="caption">{t('appearance.hapticsHint')}</Text>
        </View>
        <Switch testID="haptics-switch" value={haptics} onValueChange={(v) => onHaptics?.(v)} trackColor={{ true: colors.primary[500], false: colors.paper.line }} />
      </View>

      <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.paper.card }, shadow.soft]}>
        <View style={{ flex: 1 }}>
          <Text variant="subtitle">{t('appearance.notificationsOn')}</Text>
          <Text variant="caption">{t('appearance.notificationsHint')}</Text>
        </View>
        <Switch testID="notifications-switch" value={notifications} onValueChange={(v) => onNotifications?.(v)} trackColor={{ true: colors.primary[500], false: colors.paper.line }} />
      </View>

      <SectionTitle>{t('appearance.textSize')}</SectionTitle>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['sm', 'md', 'lg'] as const).map((z) => (
          <Chip key={z} testID={`size-${z}`} label={t(`appearance.size.${z}`)} selected={textSize === z} onPress={() => onTextSize?.(z)} />
        ))}
      </View>

      <SectionTitle>{t('appearance.font')}</SectionTitle>
      <View style={{ gap: 10 }}>
        {FONT_FAMILIES.map((f) => {
          const on = f.id === font;
          return (
            <Pressable
              key={f.id}
              testID={`font-${f.id}`}
              onPress={() => onFont(f.id)}
              style={({ pressed }) => [
                { padding: 14, gap: 4, borderRadius: 18, backgroundColor: colors.paper.card, borderWidth: 2, borderColor: on ? colors.primary[500] : 'transparent', opacity: pressed ? 0.85 : 1 },
                shadow.soft,
              ]}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="caption">{lang === 'en' ? f.nameEn : f.nameAr}</Text>
                {on ? (
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary[600], alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="check" size={12} color="#FFFFFF" />
                  </View>
                ) : null}
              </View>
              <Text style={{ fontFamily: fontsReady ? f.set.bold : undefined, fontSize: 18, lineHeight: 28, color: colors.ink.DEFAULT }}>{t('appearance.fontSample')}</Text>
              <Text style={{ fontFamily: fontsReady ? f.set.regular : undefined, fontSize: 14, lineHeight: 22, color: colors.ink.soft }}>{t('home.safeBody')}</Text>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
