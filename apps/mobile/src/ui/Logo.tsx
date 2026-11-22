import Svg, { Defs, LinearGradient, Stop, Rect, Path } from 'react-native-svg';

/** The Daftarak mark (same drawing as assets/brand/logo.svg). `bare` = without the teal tile. */
export function Logo({ size = 96, bare = false }: { size?: number; bare?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox={bare ? '96 130 320 270' : '0 0 512 512'}>
      <Defs>
        <LinearGradient id="lbg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#18A999" />
          <Stop offset="1" stopColor="#0B6B63" />
        </LinearGradient>
      </Defs>
      {bare ? null : <Rect width="512" height="512" rx="116" fill="url(#lbg)" />}
      <Path d="M256 176 C214 150 156 146 112 162 L112 366 C156 350 214 354 256 380 Z" fill="#FFFFFF" />
      <Path d="M256 176 C298 150 356 146 400 162 L400 366 C356 350 298 354 256 380 Z" fill="#F7F1E4" />
      <Path d="M290 222 L356 214 M290 258 L372 250 M290 294 L340 288" stroke="#18A999" strokeWidth={12} strokeLinecap="round" />
      <Path d="M150 268 L182 298 L226 236" fill="none" stroke="#F2A93B" strokeWidth={18} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M362 150 h26 v96 l-13 -13 l-13 13 z" fill="#F2A93B" />
    </Svg>
  );
}
