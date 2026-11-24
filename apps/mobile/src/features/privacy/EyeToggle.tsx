/** The eye on sensitive screens (header right slot): shows / hides money figures. Only rendered when «إخفاء الأرقام الحساسة» is on. */
import { useTranslation } from 'react-i18next';
import type { TextProps } from 'react-native';
import { Pressable } from '../../ui/Press';
import { Icon } from '../../ui/Icon';
import { Text } from '../../ui/Text';
import { haptic } from '../../ui/haptics';
import { shadow } from '../../ui/shadow';
import colors from '../../ui/colors';
import { MASK, useSensitive } from '../../state/privacy';

export function EyeToggle({ light = false, testID = 'eye-toggle' }: { light?: boolean; testID?: string }) {
  const { t } = useTranslation();
  const { enabled, masked, toggle } = useSensitive();
  if (!enabled) return null;
  const color = light ? '#FFFFFF' : colors.ink.DEFAULT;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t(masked ? 'privacy.show' : 'privacy.hide')}
      accessibilityState={{ selected: !masked }}
      hitSlop={8}
      onPress={() => {
        haptic.select();
        toggle();
      }}
      style={({ pressed }) => [
        { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 },
        light ? { backgroundColor: 'rgba(255,255,255,0.16)' } : { backgroundColor: colors.paper.card, ...(shadow.soft as object) },
      ]}
    >
      <Icon name={masked ? 'eye' : 'eyeOff'} size={20} color={color} tint={light ? 'rgba(255,255,255,0.2)' : undefined} />
    </Pressable>
  );
}

/**
 * Money text that follows the screen's eye: •••• (same style, font size and line height, so rows keep their height)
 * while masked. Pass `masked` to force a value; otherwise it reads the store.
 */
export function SensitiveText({ children, masked, ...rest }: TextProps & { children: string; masked?: boolean }) {
  const { t } = useTranslation();
  const s = useSensitive();
  const hide = masked ?? s.masked;
  return (
    <Text {...rest} accessibilityLabel={hide ? t('privacy.hiddenValue') : rest.accessibilityLabel}>
      {hide ? MASK : children}
    </Text>
  );
}
