import { View } from 'react-native';
import { Text } from './Text';

/** Onboarding progress: "الخطوة 2 من 4" + segmented bar. */
export function Steps({ current, total, label, light = false }: { current: number; total: number; label: string; light?: boolean }) {
  return (
    <View className="gap-2">
      <Text variant="caption" style={{ color: light ? 'rgba(255,255,255,0.85)' : undefined }}>
        {label}
      </Text>
      <View className="flex-row gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 5,
              borderRadius: 3,
              backgroundColor: i < current ? (light ? '#FFFFFF' : '#0E8C80') : light ? 'rgba(255,255,255,0.25)' : '#E4DAC6',
            }}
          />
        ))}
      </View>
    </View>
  );
}
