import { Appearance as RNAppearance } from 'react-native';
import { useTranslation } from 'react-i18next';
import { getDb } from '../../db/client';
import { changeSetting } from '../../domain/settings/settings';
import { useApp } from '../../state/app';
import { reloadAppData } from '../../state/boot';
import { applyFont, applyTheme, setTextSize, useTheme, type Appearance, type FontId, type PaletteId, type TextSize } from '../../ui';
import { AppearanceView } from '../../features/settings/AppearanceView';

/** Palette + light/dark/comfort/system. Applies instantly to the whole app and is saved per device. */
export default function AppearanceScreen() {
  const { i18n } = useTranslation();
  const user = useApp((s) => s.user)!;
  const device = useApp((s) => s.device)!;
  const palette = useTheme((s) => s.palette);
  const appearance = useTheme((s) => s.appearance);
  const font = useTheme((s) => s.font);
  const textSize = useTheme((s) => s.textSize);
  const setSize = async (z: TextSize) => {
    useTheme.setState({ returnTo: '/settings/appearance' });
    setTextSize(z);
    await changeSetting(getDb(), 'textSize', z, { userId: user.id, deviceId: device.id });
    await reloadAppData();
  };
  const set = async (p: PaletteId, a: Appearance) => {
    useTheme.setState({ returnTo: '/settings/appearance' });
    applyTheme(p, a, RNAppearance.getColorScheme() === 'dark');
    const db = getDb();
    await changeSetting(db, 'palette', p, { userId: user.id, deviceId: device.id });
    await changeSetting(db, 'appearance', a, { userId: user.id, deviceId: device.id });
    await reloadAppData();
  };
  const setFont = async (f: FontId) => {
    useTheme.setState({ returnTo: '/settings/appearance' });
    await applyFont(f);
    await changeSetting(getDb(), 'font', f, { userId: user.id, deviceId: device.id });
    await reloadAppData();
  };
  return (
    <AppearanceView
      palette={palette}
      appearance={appearance}
      font={font}
      textSize={textSize}
      onTextSize={(z) => void setSize(z)}
      lang={i18n.language}
      onPalette={(p) => void set(p, appearance)}
      onAppearance={(a) => void set(palette, a)}
      onFont={(f) => void setFont(f)}
    />
  );
}
