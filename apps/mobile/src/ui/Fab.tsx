import { PressableScale } from './PressableScale';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon, type IconName } from './Icon';
import { shadow } from './shadow';
import colors from './colors';

/** Floating "+" (adding lives in each list's + button — SPEC §10). Sits at the end side, thumb zone. */
export function Fab({ onPress, icon = 'plus', testID }: { onPress: () => void; icon?: IconName; testID?: string }) {
  return (
    <PressableScale testID={testID} accessibilityRole="button" onPress={onPress} feedback="tap" scaleTo={0.92} style={[{ position: 'absolute', end: 20, bottom: 20, borderRadius: 30 }, shadow.lifted]}>
      <LinearGradient colors={[colors.grad[0], colors.grad[2]]} style={{ width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} color="#FFFFFF" size={24} />
      </LinearGradient>
    </PressableScale>
  );
}
