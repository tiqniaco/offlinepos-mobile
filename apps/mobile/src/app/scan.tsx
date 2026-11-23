import { useEffect, useRef, useState } from 'react';
import { fonts } from '../ui/fonts';
import { Linking, Platform, View } from 'react-native';
import { Pressable } from '../ui/Press';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { fx } from '../ui/fx';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, Button, Icon, colors } from '../ui';
import { useScanner } from '../state/scanner';
import { toast } from '../state/toast';
import { errorMessage } from '../lib/errors';

/**
 * Full-screen camera scanner (vision-camera + ML Kit barcode scanner).
 * Single mode returns after the first code; continuous mode (stock count) keeps scanning and shows
 * the result of each scan. The same code is ignored for 1.5 s so one scan isn't counted twice.
 */
export default function ScanScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const req = useScanner((s) => s.request);
  const [msg, setMsg] = useState<string | null>(null);
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const busy = useRef(false);

  useEffect(() => () => useScanner.getState().set(null), []);

  const onCode = async (code: string) => {
    const now = Date.now();
    if (busy.current || (code === last.current.code && now - last.current.at < 1500)) return;
    last.current = { code, at: now };
    busy.current = true;
    if (!req?.continuous) fx.scan();
    try {
      if (!req?.continuous) {
        router.back();
        await req?.onCode(code);
        return;
      }
      setMsg((await req.onCode(code)) ?? code);
    } catch (e) {
      fx.notFound();
      const m = errorMessage(t, e);
      if (req?.continuous) setMsg(m);
      else toast(m, 'error');
    } finally {
      busy.current = false;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {Platform.OS === 'web' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff' }}>{t('scan.unavailable')}</Text>
        </View>
      ) : (
        <NativeScanner onCode={(c) => void onCode(c)} onError={(m) => setMsg(m)} />
      )}
      {/* Frame overlay */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 280, height: 170, borderRadius: 24, borderWidth: 3, borderColor: colors.accent.onDark }} />
        <Text style={{ color: '#fff', marginTop: 16, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 }}>{t('scan.hint')}</Text>
      </View>
      <View style={{ position: 'absolute', top: insets.top + 8, start: 16 }}>
        <Pressable onPress={() => router.back()} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="back" color="#fff" tint="transparent" />
        </Pressable>
      </View>
      {!req?.continuous && msg ? (
        <View style={{ position: 'absolute', bottom: insets.bottom + 20, left: 20, right: 20 }}>
          <View style={{ backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 16, padding: 14 }}>
            <Text variant="subtitle" style={{ textAlign: 'center' }}>{msg}</Text>
          </View>
        </View>
      ) : null}
      {req?.continuous ? (
        <View style={{ position: 'absolute', bottom: insets.bottom + 20, left: 20, right: 20, gap: 10 }}>
          {msg ? (
            <View style={{ backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 16, padding: 14 }}>
              <Text variant="subtitle" style={{ textAlign: 'center' }}>{msg}</Text>
            </View>
          ) : null}
          <Button title={t('scan.done')} onPress={() => router.back()} />
        </View>
      ) : null}
    </View>
  );
}

/** Camera + permission flow; also embedded by «امسح الباركود وكمّل» (products/scan-add), paused with `active`. */
export function NativeScanner({ onCode, onError, active = true }: { onCode: (code: string) => void; onError: (msg: string) => void; active?: boolean }) {
  const { t } = useTranslation();
  // Loaded lazily so the web preview and Jest never touch the native camera modules.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useCameraPermission } = require('react-native-vision-camera') as typeof import('react-native-vision-camera');
  const perm = useCameraPermission();
  useEffect(() => {
    if (!perm.hasPermission && perm.canRequestPermission) void perm.requestPermission();
  }, [perm]);
  if (!perm.hasPermission) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
        <Text style={{ color: '#fff', textAlign: 'center' }}>{t('scan.permission')}</Text>
        {perm.canRequestPermission ? (
          <Button title={t('scan.allow')} onPress={() => void perm.requestPermission()} />
        ) : (
          <Button title={t('scan.openSettings')} onPress={() => void Linking.openSettings()} />
        )}
      </View>
    );
  }
  return <ScannerCamera onCode={onCode} onError={() => onError(t('scan.cameraError'))} active={active} />;
}

/** Back camera + barcode output, with a flashlight toggle for dark shops / stockrooms. */
function ScannerCamera({ onCode, onError, active }: { onCode: (code: string) => void; onError: () => void; active: boolean }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Camera, useCameraDevice } = require('react-native-vision-camera') as typeof import('react-native-vision-camera');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useBarcodeScannerOutput } = require('react-native-vision-camera-barcode-scanner') as typeof import('react-native-vision-camera-barcode-scanner');
  const device = useCameraDevice('back');
  const [torch, setTorch] = useState(false);
  const output = useBarcodeScannerOutput({
    barcodeFormats: ['all-formats'],
    onBarcodeScanned: (codes) => {
      const v = codes.find((c) => c.rawValue)?.rawValue;
      if (v) onCode(v);
    },
    onError,
  });
  if (!device) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: '#fff', textAlign: 'center' }}>{t('scan.cameraError')}</Text>
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <Camera style={{ flex: 1 }} isActive={active} device={device} outputs={[output]} torchMode={torch ? 'on' : 'off'} onError={onError} />
      {device.hasTorch ? (
        <View style={{ position: 'absolute', top: insets.top + 8, end: 16 }}>
          <Pressable
            testID="scan-torch"
            accessibilityRole="switch"
            accessibilityState={{ checked: torch }}
            accessibilityLabel={t('scan.torch')}
            onPress={() => setTorch((v) => !v)}
            style={{ height: 46, paddingHorizontal: 14, borderRadius: 23, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: torch ? '#FFFFFF' : 'rgba(0,0,0,0.45)' }}
          >
            <Text style={{ fontSize: 18, lineHeight: 22 }}>{'\u{1F526}'}</Text>
            <Text style={{ color: torch ? '#000' : '#fff', fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 }}>{torch ? t('scan.torchOff') : t('scan.torchOn')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
