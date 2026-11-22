/**
 * Small custom duotone icon set (PLAN.md §3.5): a soft tinted fill + a strong stroke in the same hue,
 * so icons feel warm and specific to the app instead of a stock outline pack.
 * Directional icons are mirrored automatically in RTL.
 */
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { I18nManager, Platform } from 'react-native';
import i18n from 'i18next';
import colors from './colors.json';

export type IconName = 'home' | 'more' | 'phone' | 'shield' | 'users' | 'lock' | 'globe' | 'card' | 'info' | 'chevron' | 'back' | 'fingerprint' | 'check' | 'store' | 'truck' | 'book' | 'cloudOff' | 'plus' | 'warning' | 'list' | 'backspace';

const MIRRORED: IconName[] = ['chevron', 'back'];

export function Icon({ name, size = 24, color = colors.teal[600], tint }: { name: IconName; size?: number; color?: string; tint?: string }) {
  const fill = tint ?? color + '26'; // ~15% alpha of the stroke colour
  const sw = 1.8;
  const p = { stroke: color, strokeWidth: sw, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  const rtl = Platform.OS === 'web' ? i18n.language !== 'en' : I18nManager.isRTL;
  const flip = rtl && MIRRORED.includes(name) ? { transform: [{ scaleX: -1 }] } : undefined;
  const body = (() => {
    switch (name) {
      case 'home':
        return (<><Path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" fill={fill} /><Path d="M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1v-9" {...p} /></>);
      case 'more':
        return (<><Rect x="3.5" y="3.5" width="7" height="7" rx="2" fill={fill} /><Rect x="13.5" y="13.5" width="7" height="7" rx="2" fill={fill} /><Rect x="3.5" y="3.5" width="7" height="7" rx="2" {...p} /><Rect x="13.5" y="3.5" width="7" height="7" rx="2" {...p} /><Rect x="3.5" y="13.5" width="7" height="7" rx="2" {...p} /><Rect x="13.5" y="13.5" width="7" height="7" rx="2" {...p} /></>);
      case 'phone':
        return (<><Rect x="6" y="2.5" width="12" height="19" rx="3" fill={fill} /><Rect x="6" y="2.5" width="12" height="19" rx="3" {...p} /><Path d="M10.5 18h3" {...p} /></>);
      case 'shield':
        return (<><Path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" fill={fill} /><Path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" {...p} /><Path d="m9 12 2 2 4-4" {...p} /></>);
      case 'users':
        return (<><Circle cx="9" cy="8" r="3.5" fill={fill} /><Path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" fill={fill} /><Circle cx="9" cy="8" r="3.5" {...p} /><Path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.8a3.3 3.3 0 0 1 0 6.4M18 14.8c1.8.7 3 2.5 3.5 5.2" {...p} /></>);
      case 'lock':
        return (<><Rect x="4.5" y="10" width="15" height="11" rx="2.5" fill={fill} /><Rect x="4.5" y="10" width="15" height="11" rx="2.5" {...p} /><Path d="M8 10V7a4 4 0 0 1 8 0v3M12 14.5v2.5" {...p} /></>);
      case 'globe':
        return (<><Circle cx="12" cy="12" r="9" fill={fill} /><Circle cx="12" cy="12" r="9" {...p} /><Path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9S14.5 18.4 12 21c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z" {...p} /></>);
      case 'card':
        return (<><Rect x="2.5" y="5" width="19" height="14" rx="2.5" fill={fill} /><Rect x="2.5" y="5" width="19" height="14" rx="2.5" {...p} /><Path d="M2.5 9.5h19M6 15h4" {...p} /></>);
      case 'info':
        return (<><Circle cx="12" cy="12" r="9" fill={fill} /><Circle cx="12" cy="12" r="9" {...p} /><Path d="M12 11v5M12 8h.01" {...p} /></>);
      case 'warning':
        return (<><Path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" fill={fill} /><Path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0zM12 9.5v4M12 17h.01" {...p} /></>);
      case 'chevron':
        return <Path d="m9 6 6 6-6 6" {...p} />;
      case 'back':
        return <Path d="M15 6 9 12l6 6" {...p} />;
      case 'fingerprint':
        return (<><Path d="M6.5 8.5A6.5 6.5 0 0 1 18.5 12v2M5.5 12.5V12a6.5 6.5 0 0 1 1-3.5M9 20.5c1-2 1.5-4.5 1.5-7.5a1.5 1.5 0 0 1 3 0c0 3.5-.6 6.4-1.8 8.5M15.5 18.5c.6-1.6.9-3.5 1-5.5M8 17c.4-1.3.5-2.6.5-4a3.5 3.5 0 0 1 7 0" {...p} /></>);
      case 'check':
        return <Path d="m5 12.5 4.5 4.5L19 7.5" {...p} strokeWidth={2.4} />;
      case 'store':
        return (<><Path d="M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" fill={fill} /><Path d="M3 9.5 4.5 4h15L21 9.5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM5 12v8h14v-8M10 20v-5h4v5" {...p} /></>);
      case 'truck':
        return (<><Rect x="2.5" y="6" width="11" height="10" rx="1.5" fill={fill} /><Path d="M2.5 7.5A1.5 1.5 0 0 1 4 6h8a1.5 1.5 0 0 1 1.5 1.5V16h-11zM13.5 9.5h4l3 3.5V16h-7z" {...p} /><Circle cx="7" cy="17.5" r="1.8" {...p} fill={color} /><Circle cx="17" cy="17.5" r="1.8" {...p} fill={color} /></>);
      case 'book':
        return (<><Path d="M12 6.5C10 5 7 4.6 3.5 5.3v13C7 17.7 10 18 12 19.5c2-1.5 5-1.8 8.5-1.2v-13C17 4.6 14 5 12 6.5z" fill={fill} /><Path d="M12 6.5C10 5 7 4.6 3.5 5.3v13C7 17.7 10 18 12 19.5m0-13c2-1.5 5-1.9 8.5-1.2v13c-3.5-.6-6.5-.3-8.5 1.2m0-13v13" {...p} /></>);
      case 'cloudOff':
        return (<><Path d="M7 18h10.5a4 4 0 0 0 .7-7.9A6 6 0 0 0 7.1 9 4.5 4.5 0 0 0 7 18z" fill={fill} /><Path d="M7 18h10.5a4 4 0 0 0 .7-7.9A6 6 0 0 0 7.1 9 4.5 4.5 0 0 0 7 18zM3 3l18 18" {...p} /></>);
      case 'backspace':
        return (<><Path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z" fill={fill} /><Path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7zM12 9.5l5 5M17 9.5l-5 5" {...p} /></>);
      case 'plus':
        return <Path d="M12 5v14M5 12h14" {...p} strokeWidth={2.2} />;
      case 'list':
        return (<><Rect x="3.5" y="4" width="17" height="16" rx="3" fill={fill} /><Path d="M8 9h8M8 12.5h8M8 16h5" {...p} /><Rect x="3.5" y="4" width="17" height="16" rx="3" {...p} /></>);
    }
  })();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={flip}>
      {body}
    </Svg>
  );
}
