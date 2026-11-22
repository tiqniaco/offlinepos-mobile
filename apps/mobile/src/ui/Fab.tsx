import { Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon, type IconName } from './Icon';
import { shadow } from './shadow';
import colors from './colors';

/** Floating "+" (adding lives in each list's + button — SPEC §10). Sits at the end side, thumb zone. */
export function Fab({ onPress, icon = 'plus', testID }: { onPress: () => void; icon?: IconName; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [{ position: 'absolute', end: 20, bottom: 20, borderRadius: 30, transform: [{ scale: pressed ? 0.95 : 1 }] }, shadow.lifted]}>
      <LinearGradient colors={[colors.grad[0], colors.grad[2]]} style={{ width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} color="#FFFFFF" size={24} />
      </LinearGradient>
    </Pressable>
  );
}
