import { useState } from 'react';
import { View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { Pressable } from './Press';
import { fonts } from './fonts';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text } from './Text';
import { Icon } from './Icon';
import { Hero } from './Hero';
import { Steps } from './Steps';
import { shadow } from './shadow';
import colors from './colors';

function BackButton({ light = false }: { light?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="back"
      hitSlop={10}
      onPress={() => router.back()}
      style={({ pressed }) => [
        { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 },
        light ? { backgroundColor: 'rgba(255,255,255,0.16)' } : { backgroundColor: colors.paper.card, ...(shadow.soft as object) },
      ]}
    >
      <Icon name="back" color={light ? '#FFFFFF' : colors.ink.DEFAULT} />
    </Pressable>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 12) + 4, backgroundColor: colors.paper.DEFAULT, gap: 8 }}>{children}</View>;
}

/** Hairline under the header once the content scrolls under it (reads as a native app bar). */
function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y > 4;
    if (y !== scrolled) setScrolled(y);
  };
  return { scrolled, onScroll };
}

/**
 * Standard screen: compact app bar (back · title · actions), scrollable content that always scrolls the focused
 * field above the keyboard, and a footer that rides on top of the keyboard.
 */
export function Screen({
  children,
  title,
  subtitle,
  back = false,
  scroll = true,
  footer,
  className = '',
  right,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  back?: boolean;
  scroll?: boolean;
  footer?: React.ReactNode;
  className?: string;
  right?: React.ReactNode;
}) {
  const { scrolled, onScroll } = useScrolled();
  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
      {title || back || right ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 16,
            paddingTop: 6,
            paddingBottom: 10,
            backgroundColor: colors.paper.DEFAULT,
            borderBottomWidth: scrolled ? 1 : 0,
            borderBottomColor: colors.paper.line,
          }}
        >
          {back ? <BackButton /> : null}
          <View style={{ flex: 1 }}>
            {title ? (
              <Text variant="title" numberOfLines={1} style={{ fontSize: back ? 19 : 23, fontFamily: fonts.bold }}>
                {title}
              </Text>
            ) : null}
            {subtitle ? (
              <Text variant="caption" numberOfLines={2}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {right}
        </View>
      ) : null}
      {scroll ? (
        <KeyboardAwareScrollView
          style={{ flex: 1 }}
          bottomOffset={footer ? 96 : 24}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={32}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32 }}
        >
          <View className={`gap-3 ${className}`}>{children}</View>
        </KeyboardAwareScrollView>
      ) : (
        <View className={`flex-1 px-4 ${className}`}>{children}</View>
      )}
      {footer ? (
        <KeyboardStickyView>
          <Footer>{footer}</Footer>
        </KeyboardStickyView>
      ) : null}
    </SafeAreaView>
  );
}

/**
 * Onboarding step: gradient hero with back button, progress and title; content sits on a paper sheet
 * that overlaps the hero. Primary action is pinned to the bottom (thumb zone).
 */
export function OnboardingScreen({
  step,
  total = 4,
  stepLabel,
  title,
  subtitle,
  children,
  footer,
  back = true,
}: {
  step?: number;
  total?: number;
  stepLabel?: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  back?: boolean;
}) {
  return (
    <View className="flex-1 bg-paper">
        <KeyboardAwareScrollView style={{ flex: 1 }} bottomOffset={footer ? 96 : 24} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          <Hero>
            <View className="gap-5 px-5 pt-3">
              <View className="flex-row items-center justify-between">
                {back ? <BackButton light /> : <View style={{ height: 44 }} />}
                {step ? (
                  <View style={{ width: 120 }}>
                    <Steps current={step} total={total} label={stepLabel ?? ''} light />
                  </View>
                ) : null}
              </View>
              <View className="gap-1 pb-2">
                <Text style={{ color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 25 }}>{title}</Text>
                {subtitle ? <Text style={{ color: 'rgba(255,255,255,0.88)', fontSize: 14, fontFamily: fonts.regular }}>{subtitle}</Text> : null}
              </View>
            </View>
          </Hero>
          <View className="gap-4 px-5 pt-2">{children}</View>
        </KeyboardAwareScrollView>
        {footer ? (
          <KeyboardStickyView>
            <Footer>{footer}</Footer>
          </KeyboardStickyView>
        ) : null}
    </View>
  );
}

export function SectionTitle({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <View className="mt-2 flex-row items-center justify-between">
      <Text style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: colors.ink.soft }}>{children}</Text>
      {action}
    </View>
  );
}
