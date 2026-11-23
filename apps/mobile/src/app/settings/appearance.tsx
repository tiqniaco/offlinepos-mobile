import { Appearance as RNAppearance } from 'react-native';
import { useTranslation } from 'react-i18next';
import { getDb } from '../../db/client';
import { changeSetting } from '../../domain/settings/settings';
import { useApp } from '../../state/app';
import { reloadAppData } from '../../state/boot';
import { applyFont, applyTheme, setTextSize, useTheme, type Appearance, type FontId, type PaletteId, type TextSize } from '../../ui';
import { AppearanceView } from '../../features/settings/AppearanceView';
import { playSound, setSoundsEnabled, setSoundVolume } from '../../ui/sounds';
import { haptic, setHapticsEnabled } from '../../ui/haptics';
import { planNotifications } from '../../features/notify/notify';

/** Palette + light/dark/comfort/system. Applies instantly to the whole app and is saved per device. */
export default function AppearanceScreen() {
  const { i18n } = useTranslation();
  const user = useApp((s) => s.user)!;
  const device = useApp((s) => s.device)!;
  const palette = useTheme((s) => s.palette);
  const appearance = useTheme((s) => s.appearance);
  const font = useTheme((s) => s.font);
  const textSize = useTheme((s) => s.textSize);
  const soundsOn = useApp((s) => s.settings.sounds ?? true);
  const volume = useApp((s) => s.settings.soundVolume ?? 'medium');
  const hapticsOn = useApp((s) => s.settings.haptics ?? true);
  const notifOn = useApp((s) => s.settings.notifications ?? true);
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
      sounds={soundsOn}
      notifications={notifOn}
      onNotifications={(v) => void changeSetting(getDb(), 'notifications', v, { userId: user.id, deviceId: device.id }).then(reloadAppData).then(() => planNotifications({ ask: v }))}
      onSounds={(v) => {
        setSoundsEnabled(v);
        if (v) playSound('success');
        void changeSetting(getDb(), 'sounds', v, { userId: user.id, deviceId: device.id }).then(reloadAppData);
      }}
      soundVolume={volume}
      onSoundVolume={(v) => {
        setSoundVolume(v);
        playSound('success');
        void changeSetting(getDb(), 'soundVolume', v, { userId: user.id, deviceId: device.id }).then(reloadAppData);
      }}
      haptics={hapticsOn}
      onHaptics={(v) => {
        setHapticsEnabled(v);
        if (v) haptic.success();
        void changeSetting(getDb(), 'haptics', v, { userId: user.id, deviceId: device.id }).then(reloadAppData);
      }}
      onTextSize={(z) => void setSize(z)}
      lang={i18n.language}
      onPalette={(p) => void set(p, appearance)}
      onAppearance={(a) => void set(palette, a)}
      onFont={(f) => void setFont(f)}
    />
  );
}
