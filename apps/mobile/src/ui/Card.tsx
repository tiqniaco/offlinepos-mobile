import { Pressable, View, type ViewProps } from 'react-native';

const SHADOW = {
  shadowColor: '#3A2E1A',
  shadowOpacity: 0.07,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
};

/** Soft paper card. If onPress is set, the whole card is tappable (SPEC §10). */
export function Card({ children, className = '', onPress, style, ...rest }: ViewProps & { className?: string; onPress?: () => void }) {
  const cls = `rounded-card bg-paper-card p-4 border border-paper-line/60 ${className}`;
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} className={`${cls} active:opacity-80`} style={[SHADOW, style]} {...rest}>
        {children}
      </Pressable>
    );
  }
  return (
    <View className={cls} style={[SHADOW, style]} {...rest}>
      {children}
    </View>
  );
}
