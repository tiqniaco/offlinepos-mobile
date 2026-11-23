import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Modal, PanResponder, ScrollView, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Pressable } from './Press';
import { fonts } from './fonts';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './Text';
import colors from './colors';
import { haptic } from './haptics';

const SCREEN_H = Dimensions.get('window').height;
const OPEN = { toValue: 0, damping: 26, stiffness: 260, mass: 0.9, useNativeDriver: true } as const;

/**
 * Native-feeling bottom sheet: slides up with a spring, follows the finger when dragged down (handle, title or
 * the top of the content), closes past a threshold or on a quick flick, snaps back otherwise. The backdrop fades
 * with the drag. Animations run on the native driver.
 */
export function Sheet({ visible, onClose, title, children, footer }: { visible: boolean; onClose: () => void; title?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const y = useRef(new Animated.Value(SCREEN_H)).current;
  const height = useRef(SCREEN_H * 0.6);
  const scrollTop = useRef(true);
  const closing = useRef(false);

  useEffect(() => {
    if (visible) {
      closing.current = false;
      setMounted(true);
      y.setValue(SCREEN_H);
      requestAnimationFrame(() => Animated.spring(y, OPEN).start());
    } else if (mounted) {
      Animated.timing(y, { toValue: height.current + 40, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const dismiss = () => {
    if (closing.current) return;
    closing.current = true;
    haptic.select();
    Animated.timing(y, { toValue: height.current + 40, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
      setMounted(false);
      onClose();
    });
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => scrollTop.current && g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => y.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > height.current * 0.28 || g.vy > 1.1) dismiss();
        else Animated.spring(y, OPEN).start();
      },
      onPanResponderTerminate: () => Animated.spring(y, OPEN).start(),
    }),
  ).current;

  if (!mounted) return null;
  const backdrop = y.interpolate({ inputRange: [0, Math.max(1, height.current)], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior="padding">
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(16,24,40,0.45)', opacity: backdrop }}>
          <Pressable onPress={dismiss} style={{ flex: 1 }} />
        </Animated.View>
        <Animated.View
          {...pan.panHandlers}
          onLayout={(e) => (height.current = e.nativeEvent.layout.height)}
          style={{
            maxHeight: '88%',
            backgroundColor: colors.paper.DEFAULT,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingBottom: Math.max(insets.bottom, 16),
            transform: [{ translateY: y }],
            shadowColor: '#101828',
            shadowOpacity: 0.18,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: -6 },
            elevation: 24,
          }}
        >
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: colors.paper.line }} />
          </View>
          {title ? <Text style={{ fontFamily: fonts.bold, fontSize: 16.5, color: colors.ink.DEFAULT, paddingHorizontal: 20, paddingTop: 6 }}>{title}</Text> : null}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(e) => (scrollTop.current = e.nativeEvent.contentOffset.y <= 0)}
            contentContainerStyle={{ padding: 20, paddingTop: 12, gap: 12 }}
          >
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: 20, gap: 8 }}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
