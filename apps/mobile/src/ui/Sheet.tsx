import { Modal, ScrollView, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Pressable } from './Press';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { fonts } from './fonts';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './Text';
import colors from './colors';

/** Bottom sheet (thumb-friendly) for pickers, quick forms and confirmations. */
export function Sheet({ visible, onClose, title, children, footer }: { visible: boolean; onClose: () => void; title?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Animated.View entering={FadeIn.duration(180)} style={{ flex: 1, backgroundColor: 'rgba(16,24,40,0.45)' }}>
          <Pressable onPress={onClose} style={{ flex: 1 }} />
        </Animated.View>
        <Animated.View entering={SlideInDown.springify().damping(20).stiffness(200)} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.paper.DEFAULT, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: Math.max(insets.bottom, 16), maxHeight: '88%' }}>
          <View style={{ alignItems: 'center', paddingTop: 10 }}>
            <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: colors.paper.line }} />
          </View>
          {title ? (
            <Text style={{ fontFamily: fonts.bold, fontSize: 18, lineHeight: 26, color: colors.ink.DEFAULT, paddingHorizontal: 20, paddingTop: 10 }}>{title}</Text>
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 12 }}>
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: 20, gap: 8 }}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
