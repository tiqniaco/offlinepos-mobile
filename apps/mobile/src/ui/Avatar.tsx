import { View } from 'react-native';
import { Text } from './Text';

export function Avatar({ name, color, size = 56, ring = false }: { name: string; color: string; size?: number; ring?: boolean }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: ring ? 3 : 0,
        borderColor: 'rgba(255,255,255,0.85)',
      }}
    >
      <Text style={{ color: '#FFFFFF', fontSize: size * 0.4, lineHeight: size * 0.52, fontFamily: 'IBMPlexSansArabic_700Bold' }}>{name.trim().charAt(0)}</Text>
    </View>
  );
}
