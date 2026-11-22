/**
 * Small custom duotone icon set (PLAN.md §3.5): a soft tinted fill + a strong stroke in the same hue,
 * so icons feel warm and specific to the app instead of a stock outline pack.
 * Directional icons are mirrored automatically in RTL.
 */
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { I18nManager, Platform } from 'react-native';
import i18n from 'i18next';
import colors from './colors';

export type IconName = 'home' | 'more' | 'phone' | 'shield' | 'users' | 'lock' | 'globe' | 'card' | 'info' | 'chevron' | 'back' | 'fingerprint' | 'check' | 'store' | 'truck' | 'book' | 'cloudOff' | 'plus' | 'warning' | 'list' | 'backspace' | 'scan' | 'camera' | 'image' | 'box' | 'tag' | 'search' | 'dots' | 'trash' | 'edit' | 'minus' | 'upload' | 'download' | 'refresh' | 'layers' | 'clipboard' | 'whatsapp' | 'cash' | 'receipt' | 'clock' | 'cart' | 'printer' | 'file' | 'sheet' | 'arrowIn' | 'arrowOut' | 'calendar' | 'bell' | 'wallet' | 'chart';

const MIRRORED: IconName[] = ['chevron', 'back', 'arrowIn', 'arrowOut'];

export function Icon({ name, size = 22, color = colors.primary[600], tint }: { name: IconName; size?: number; color?: string; tint?: string }) {
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
      case 'scan':
        return (<><Rect x="6" y="7" width="12" height="10" rx="1" fill={fill} /><Path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16M7 8v8M10 8v8M13 8v8M16.5 8v8" {...p} /></>);
      case 'camera':
        return (<><Rect x="3" y="6.5" width="18" height="13.5" rx="3" fill={fill} /><Path d="M8 6.5 9.5 4h5L16 6.5h2a3 3 0 0 1 3 3V17a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9.5a3 3 0 0 1 3-3z" {...p} /><Circle cx="12" cy="13" r="3.5" {...p} /></>);
      case 'image':
        return (<><Rect x="3" y="4" width="18" height="16" rx="3" fill={fill} /><Rect x="3" y="4" width="18" height="16" rx="3" {...p} /><Circle cx="9" cy="9.5" r="1.8" {...p} /><Path d="m4 18 5.5-5.5 3.5 3.5 2.5-2.5L20 18" {...p} /></>);
      case 'box':
        return (<><Path d="M12 3 20 7v10l-8 4-8-4V7z" fill={fill} /><Path d="M12 3 20 7v10l-8 4-8-4V7zM4 7l8 4 8-4M12 11v10" {...p} /></>);
      case 'tag':
        return (<><Path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" fill={fill} /><Path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" {...p} /><Circle cx="8" cy="8" r="1.6" {...p} /></>);
      case 'search':
        return (<><Circle cx="11" cy="11" r="7" fill={fill} /><Circle cx="11" cy="11" r="7" {...p} /><Path d="m20 20-4-4" {...p} /></>);
      case 'dots':
        return (<><Circle cx="5" cy="12" r="1.8" fill={color} /><Circle cx="12" cy="12" r="1.8" fill={color} /><Circle cx="19" cy="12" r="1.8" fill={color} /></>);
      case 'trash':
        return (<><Path d="M6 7h12l-1 13H7z" fill={fill} /><Path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" {...p} /></>);
      case 'edit':
        return (<><Path d="M4 20h4L19 9l-4-4L4 16z" fill={fill} /><Path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" {...p} /></>);
      case 'minus':
        return <Path d="M5 12h14" {...p} strokeWidth={2.2} />;
      case 'upload':
        return (<><Path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" fill={fill} /><Path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3M12 15V4M7.5 8.5 12 4l4.5 4.5" {...p} /></>);
      case 'download':
        return (<><Path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" fill={fill} /><Path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3M12 4v11M7.5 10.5 12 15l4.5-4.5" {...p} /></>);
      case 'refresh':
        return (<><Path d="M20 11a8 8 0 0 0-14.6-4.5M4 13a8 8 0 0 0 14.6 4.5M5 3v4h4M19 21v-4h-4" {...p} /></>);
      case 'layers':
        return (<><Path d="m12 3 9 5-9 5-9-5z" fill={fill} /><Path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5" {...p} /></>);
      case 'clipboard':
        return (<><Rect x="5" y="4.5" width="14" height="16.5" rx="2.5" fill={fill} /><Path d="M9 4.5H7.5A2.5 2.5 0 0 0 5 7v11.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V7a2.5 2.5 0 0 0-2.5-2.5H15M9 3h6v3H9zM8.5 11l2 2 4-4M8.5 16.5h7" {...p} /></>);
      case 'whatsapp':
        return (<><Path d="M12 3.5a8.5 8.5 0 0 0-7.4 12.7L3.5 20.5l4.4-1.1A8.5 8.5 0 1 0 12 3.5z" fill={fill} /><Path d="M12 3.5a8.5 8.5 0 0 0-7.4 12.7L3.5 20.5l4.4-1.1A8.5 8.5 0 1 0 12 3.5z" {...p} /><Path d="M9 8.5c.3-.4.8-.4 1 0l.8 1.6c.1.3 0 .6-.2.8l-.5.5c.6 1.2 1.6 2.2 2.8 2.8l.5-.5c.2-.2.5-.3.8-.2l1.6.8c.4.2.4.7 0 1-.6.7-1.5 1-2.4.7A7.4 7.4 0 0 1 8.4 11c-.3-.9 0-1.8.6-2.5z" {...p} strokeWidth={1.4} /></>);
      case 'cash':
        return (<><Rect x="2.5" y="6" width="19" height="12" rx="2.5" fill={fill} /><Rect x="2.5" y="6" width="19" height="12" rx="2.5" {...p} /><Circle cx="12" cy="12" r="2.6" {...p} /><Path d="M6 9.5v.01M18 14.5v.01" {...p} strokeWidth={2.4} /></>);
      case 'wallet':
        return (<><Path d="M4 7.5h15a1.5 1.5 0 0 1 1.5 1.5v9.5A1.5 1.5 0 0 1 19 20H5.5A2.5 2.5 0 0 1 3 17.5v-10" fill={fill} /><Path d="M17 7.5V5.5A1.5 1.5 0 0 0 15.5 4H5.5a2.5 2.5 0 0 0 0 5H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 20H5.5A2.5 2.5 0 0 1 3 17.5v-11M16.5 14h.01" {...p} /></>);
      case 'receipt':
        return (<><Path d="M5.5 3h13v18l-2.2-1.5-2.1 1.5-2.2-1.5-2.2 1.5-2.1-1.5-2.2 1.5z" fill={fill} /><Path d="M5.5 3h13v18l-2.2-1.5-2.1 1.5-2.2-1.5-2.2 1.5-2.1-1.5-2.2 1.5zM9 8h6M9 11.5h6M9 15h3.5" {...p} /></>);
      case 'clock':
        return (<><Circle cx="12" cy="12" r="9" fill={fill} /><Circle cx="12" cy="12" r="9" {...p} /><Path d="M12 7v5l3.5 2" {...p} /></>);
      case 'cart':
        return (<><Path d="M6 6.5h14l-1.6 7.2a2 2 0 0 1-2 1.6H9a2 2 0 0 1-2-1.6z" fill={fill} /><Path d="M2.5 3.5h2.3L7 13.7a2 2 0 0 0 2 1.6h7.4a2 2 0 0 0 2-1.6L20 6.5H5.6" {...p} /><Circle cx="9.5" cy="19.5" r="1.3" {...p} /><Circle cx="16.5" cy="19.5" r="1.3" {...p} /></>);
      case 'printer':
        return (<><Rect x="3" y="9" width="18" height="8" rx="2" fill={fill} /><Path d="M7 9V3.5h10V9M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" {...p} /><Rect x="7" y="14" width="10" height="7" rx="1" {...p} /></>);
      case 'file':
        return (<><Path d="M6 2.5h8l4.5 4.5v13a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V4A1.5 1.5 0 0 1 6 2.5z" fill={fill} /><Path d="M6 2.5h8l4.5 4.5v13a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V4A1.5 1.5 0 0 1 6 2.5zM13.5 2.5V7.5h5M8 13h8M8 16.5h5" {...p} /></>);
      case 'sheet':
        return (<><Rect x="3.5" y="3.5" width="17" height="17" rx="2.5" fill={fill} /><Rect x="3.5" y="3.5" width="17" height="17" rx="2.5" {...p} /><Path d="M3.5 9h17M3.5 14.5h17M9.5 9v11.5" {...p} /></>);
      case 'arrowIn':
        return (<><Circle cx="12" cy="12" r="9" fill={fill} /><Path d="M15.5 8.5 8.5 15.5M8.5 9v6.5H15" {...p} /></>);
      case 'arrowOut':
        return (<><Circle cx="12" cy="12" r="9" fill={fill} /><Path d="M8.5 15.5l7-7M9 8.5h6.5V15" {...p} /></>);
      case 'calendar':
        return (<><Rect x="3.5" y="5" width="17" height="15.5" rx="2.5" fill={fill} /><Rect x="3.5" y="5" width="17" height="15.5" rx="2.5" {...p} /><Path d="M3.5 10h17M8 3v4M16 3v4" {...p} /></>);
      case 'bell':
        return (<><Path d="M6 10a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 15 6 10z" fill={fill} /><Path d="M6 10a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 15 6 10zM10 19.5a2.2 2.2 0 0 0 4 0" {...p} /></>);
      case 'chart':
        return (<><Rect x="3.5" y="3.5" width="17" height="17" rx="3" fill={fill} /><Path d="M7.5 16v-4M12 16V8M16.5 16v-6" {...p} strokeWidth={2.2} /></>);
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
