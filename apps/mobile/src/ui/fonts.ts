/**
 * Font families the user can choose (المظهر). `fonts` is a live object like `colors`: components read
 * `fonts.bold` etc. at render time. Default: Readex Pro (clearest digits/prices at small sizes).
 * Only the selected family's files are loaded (expo-font), so start-up stays fast.
 */
import * as Font from 'expo-font';

export type FontId = 'readex' | 'alexandria' | 'almarai' | 'plex';

export interface FontSet {
  regular: string;
  medium: string;
  semibold: string;
  bold: string;
}

interface FontFamilyDef {
  id: FontId;
  nameAr: string;
  nameEn: string;
  set: FontSet;
  load: () => Record<string, number>;
}

/* eslint-disable @typescript-eslint/no-require-imports */
export const FONT_FAMILIES: FontFamilyDef[] = [
  {
    id: 'readex',
    nameAr: 'ريدكس',
    nameEn: 'Readex Pro',
    set: { regular: 'ReadexPro_400Regular', medium: 'ReadexPro_500Medium', semibold: 'ReadexPro_600SemiBold', bold: 'ReadexPro_700Bold' },
    load: () => {
      const f = require('@expo-google-fonts/readex-pro');
      return { ReadexPro_400Regular: f.ReadexPro_400Regular, ReadexPro_500Medium: f.ReadexPro_500Medium, ReadexPro_600SemiBold: f.ReadexPro_600SemiBold, ReadexPro_700Bold: f.ReadexPro_700Bold };
    },
  },
  {
    id: 'alexandria',
    nameAr: 'إسكندرية',
    nameEn: 'Alexandria',
    set: { regular: 'Alexandria_400Regular', medium: 'Alexandria_500Medium', semibold: 'Alexandria_600SemiBold', bold: 'Alexandria_700Bold' },
    load: () => {
      const f = require('@expo-google-fonts/alexandria');
      return { Alexandria_400Regular: f.Alexandria_400Regular, Alexandria_500Medium: f.Alexandria_500Medium, Alexandria_600SemiBold: f.Alexandria_600SemiBold, Alexandria_700Bold: f.Alexandria_700Bold };
    },
  },
  {
    id: 'almarai',
    nameAr: 'المراعي',
    nameEn: 'Almarai',
    // Almarai has no 500/600 weights: medium → regular, semibold → bold.
    set: { regular: 'Almarai_400Regular', medium: 'Almarai_400Regular', semibold: 'Almarai_700Bold', bold: 'Almarai_800ExtraBold' },
    load: () => {
      const f = require('@expo-google-fonts/almarai');
      return { Almarai_400Regular: f.Almarai_400Regular, Almarai_700Bold: f.Almarai_700Bold, Almarai_800ExtraBold: f.Almarai_800ExtraBold };
    },
  },
  {
    id: 'plex',
    nameAr: 'بلكس (هوية تقنية)',
    nameEn: 'IBM Plex (TIQNIA brand)',
    set: { regular: 'IBMPlexSansArabic_400Regular', medium: 'IBMPlexSansArabic_500Medium', semibold: 'IBMPlexSansArabic_600SemiBold', bold: 'IBMPlexSansArabic_700Bold' },
    load: () => {
      const f = require('@expo-google-fonts/ibm-plex-sans-arabic');
      return {
        IBMPlexSansArabic_400Regular: f.IBMPlexSansArabic_400Regular,
        IBMPlexSansArabic_500Medium: f.IBMPlexSansArabic_500Medium,
        IBMPlexSansArabic_600SemiBold: f.IBMPlexSansArabic_600SemiBold,
        IBMPlexSansArabic_700Bold: f.IBMPlexSansArabic_700Bold,
      };
    },
  },
];
/* eslint-enable @typescript-eslint/no-require-imports */

export const fonts: FontSet = { ...FONT_FAMILIES[0]!.set };

export type TextSize = 'sm' | 'md' | 'lg';
export const TEXT_SIZES: Record<TextSize, number> = { sm: 0.92, md: 1, lg: 1.1 };
/** Live type settings: `scale` = user's text size; `legacy` shrinks hard-coded sizes to the compact scale. */
export const type = { scale: 1, legacy: 0.8, size: 'md' as TextSize };
/** The phone's own font-size setting may enlarge text up to this factor (readable, but layouts don't break). */
export const MAX_FONT_MULTIPLIER = 1.15;
/** Readex Pro's Arabic glyphs are tall: anything below ~1.6× clips the top/bottom on Android. */
export const LINE = 1.62;
export function applyTextSize(size: TextSize) {
  type.size = TEXT_SIZES[size] ? size : 'md';
  type.scale = TEXT_SIZES[type.size];
}
export let currentFont: FontId = 'readex';

/** Load (if needed) and activate a font family. Falls back to Readex Pro. */
export async function loadFontFamily(id: FontId): Promise<void> {
  const fam = FONT_FAMILIES.find((f) => f.id === id) ?? FONT_FAMILIES[0]!;
  await Font.loadAsync(fam.load());
  Object.assign(fonts, fam.set);
  currentFont = fam.id;
}

/** Load every family (without switching) so the appearance screen can preview them. */
export async function preloadAllFonts(): Promise<void> {
  await Promise.all(FONT_FAMILIES.map((f) => Font.loadAsync(f.load())));
}
