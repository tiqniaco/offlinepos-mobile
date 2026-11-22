import { Pressable, View } from 'react-native';
import { fonts } from './fonts';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToast } from '../state/toast';
import { Text } from './Text';
import { Icon } from './Icon';
import { shadow } from './shadow';
import colors from './colors';

/** Snackbar host, mounted once in the root layout. */
export function ToastHost() {
  const t = useToast((s) => s.toast);
  const hide = useToast((s) => s.hide);
  const insets = useSafeAreaInsets();
  if (!t) return null;
  const bg = t.tone === 'error' ? '#A8352E' : colors.inverse.bg;
  const fg = t.tone === 'error' ? '#FFFFFF' : colors.inverse.text;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 84 }}>
      <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: bg, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 }, shadow.lifted]}>
        <Icon name={t.tone === 'error' ? 'warning' : 'check'} color={t.tone === 'success' ? '#3FB561' : fg} tint="transparent" size={20} />
        <Text style={{ flex: 1, color: fg, fontFamily: fonts.medium, fontSize: 14.5, lineHeight: 22 }}>{t.text}</Text>
        {t.action ? (
          <Pressable
            hitSlop={8}
            onPress={() => {
              hide();
              t.action!.onPress();
            }}
          >
            <Text style={{ color: colors.isDark ? colors.primary[600] : colors.accent.onDark, fontFamily: fonts.bold, fontSize: 15, lineHeight: 22 }}>{t.action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
