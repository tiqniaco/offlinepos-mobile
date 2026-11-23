import { View, type ViewProps } from 'react-native';
import { PressableScale } from './PressableScale';
import { shadow } from './shadow';
import colors from './colors';

/** Paper card with a soft warm shadow. If onPress is set, the whole card is tappable (SPEC §10). */
export function Card({ children, className = '', onPress, style, padded = true, ...rest }: ViewProps & { className?: string; onPress?: () => void; padded?: boolean }) {
  const cls = `rounded-[16px] bg-paper-card ${padded ? 'p-3.5' : ''} ${className}`;
  if (onPress) {
    // Plain style (no classes) on the animated pressable — see PressableScale.
    return (
      <PressableScale
        accessibilityRole="button"
        onPress={onPress}
        scaleTo={0.985}
        style={[{ borderRadius: 16, backgroundColor: colors.paper.card }, padded ? { padding: 14 } : null, shadow.soft, style as object]}
        {...rest}
      >
        {className ? <View className={className}>{children}</View> : children}
      </PressableScale>
    );
  }
  return (
    <View className={cls} style={[shadow.soft, style]} {...rest}>
      {children}
    </View>
  );
}
