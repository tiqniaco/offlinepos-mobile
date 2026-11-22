import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from './colors';

/**
 * Teal gradient header with soft decorative rings and a curved bottom edge.
 * Used at the top of onboarding, lock and home — gives the app its recognisable look.
 */
export function Hero({ children, height, curve = true }: { children?: React.ReactNode; height?: number; curve?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ height: height ? height + insets.top : undefined }}>
      <LinearGradient
        colors={colors.grad}
        locations={[0, 0.65, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{ flex: height ? 1 : undefined, paddingTop: insets.top, overflow: 'hidden' }}
      >
        <Svg width="100%" height="100%" style={{ position: 'absolute' }} viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">
          <Circle cx="360" cy="30" r="120" fill="#FFFFFF" opacity={0.06} />
          <Circle cx="360" cy="30" r="70" fill="#FFFFFF" opacity={0.06} />
          <Circle cx="30" cy="250" r="90" fill={colors.accent.DEFAULT} opacity={0.16} />
          <Path d="M0 120 Q 120 70 240 130 T 400 110" stroke="#FFFFFF" strokeOpacity={0.08} strokeWidth={2} fill="none" />
        </Svg>
        <View style={{ paddingBottom: curve ? 36 : 20 }}>{children}</View>
        {curve ? (
          <Svg width="100%" height={28} viewBox="0 0 400 28" preserveAspectRatio="none" style={{ position: 'absolute', bottom: -1 }}>
            <Path d="M0 28 L0 10 Q 200 34 400 10 L400 28 Z" fill={colors.paper.DEFAULT} />
          </Svg>
        ) : null}
      </LinearGradient>
    </View>
  );
}
