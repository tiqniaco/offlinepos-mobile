import { Pressable, View, type ViewProps } from 'react-native';
import { shadow } from './shadow';

/** Paper card with a soft warm shadow. If onPress is set, the whole card is tappable (SPEC §10). */
export function Card({ children, className = '', onPress, style, padded = true, ...rest }: ViewProps & { className?: string; onPress?: () => void; padded?: boolean }) {
  const cls = `rounded-[20px] bg-paper-card ${padded ? 'p-4' : ''} ${className}`;
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} className={cls} style={({ pressed }) => [shadow.soft, { opacity: pressed ? 0.85 : 1 }, style as object]} {...rest}>
        {children}
      </Pressable>
    );
  }
  return (
    <View className={cls} style={[shadow.soft, style]} {...rest}>
      {children}
    </View>
  );
}
