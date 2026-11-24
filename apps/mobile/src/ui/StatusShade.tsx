/** Screens whose coloured header scrolls away: keeps the phone's clock and icons on a solid strip, never under text. */
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from './colors';

export function StatusShade() {
  const insets = useSafeAreaInsets();
  return <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: colors.grad[1] }} />;
}
