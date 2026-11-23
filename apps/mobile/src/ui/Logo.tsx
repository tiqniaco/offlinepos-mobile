import Svg, { Defs, LinearGradient, Stop, Rect, Path, Circle } from 'react-native-svg';
import colors from './colors';

/** The Kashiro mark (receipt + check) in the active theme colours. `bare` = without the tile. Source: assets/brand/. */
const RECEIPT = 'M172 104 H340 Q360 104 360 124 V378 l-26.25 -18 l-26.25 18 l-26.25 -18 l-26.25 18 l-26.25 -18 l-26.25 18 l-26.25 -18 l-26.25 18 V124 Q152 104 172 104 Z';

export function Logo({ size = 96, bare = false }: { size?: number; bare?: boolean }) {
  const strong = colors.isDark ? '#0F4CC7' : colors.primary[600];
  const ring = bare ? 'transparent' : colors.grad[1];
  return (
    <Svg width={size} height={size} viewBox={bare ? '130 90 300 340' : '0 0 512 512'}>
      <Defs>
        <LinearGradient id="lbg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={colors.grad[0]} />
          <Stop offset="0.55" stopColor={colors.grad[1]} />
          <Stop offset="1" stopColor={colors.grad[2]} />
        </LinearGradient>
      </Defs>
      {bare ? null : <Rect width="512" height="512" rx="116" fill="url(#lbg)" />}
      <Path d={RECEIPT} fill="#FFFFFF" />
      <Path d="M190 162 H322" stroke={strong} strokeWidth={20} strokeLinecap="round" />
      <Path d="M190 210 H300 M190 250 H272" stroke={colors.primary[200]} strokeWidth={14} strokeLinecap="round" />
      <Circle cx={350} cy={350} r={66} fill="#FFFFFF" stroke={ring} strokeWidth={16} />
      <Path d="M318 352 l22 22 l42 -46" fill="none" stroke={colors.primary[500]} strokeWidth={20} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
