import { useEffect } from 'react';
import { View } from 'react-native';
import { Pressable } from './Press';
import Animated, { FadeInDown, FadeOutDown, ZoomIn } from 'react-native-reanimated';
import { haptic } from './haptics';
import { useReduceMotion } from './reduceMotion';
import { fx, fxRecently } from './fx';
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
  const reduce = useReduceMotion();
  useEffect(() => {
    // Error toast = error sound + haptic (deduplicated when the screen already played it).
    if (!t || fxRecently()) return;
    if (t.tone === 'error') fx.error();
    else if (t.tone === 'success') haptic.success();
  }, [t?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) return null;
  const bg = t.tone === 'error' ? '#A8352E' : colors.inverse.bg;
  const fg = t.tone === 'error' ? '#FFFFFF' : colors.inverse.text;
  return (
    <Animated.View key={t.id} entering={FadeInDown.springify().damping(18)} exiting={FadeOutDown.duration(150)} pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 84 }}>
      <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: bg, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 }, shadow.lifted]}>
        <Animated.View entering={reduce ? undefined : ZoomIn.springify().damping(9).stiffness(260).delay(60)}>
          <Icon name={t.tone === 'error' ? 'warning' : 'check'} color={t.tone === 'success' ? '#3FB561' : fg} tint="transparent" size={20} />
        </Animated.View>
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
    </Animated.View>
  );
}
