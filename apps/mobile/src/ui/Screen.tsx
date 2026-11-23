import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
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

/** Standard screen: large title header, optional back, scrollable content, sticky footer. */
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
  const Body = scroll ? ScrollView : View;
  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {title || back ? (
          <View className="gap-2 px-4 pb-2 pt-2">
            {back || right ? (
              <View className="flex-row items-center justify-between">
                {back ? <BackButton /> : <View />}
                {right}
              </View>
            ) : null}
            {title ? (
              <View className="gap-0.5">
                <Text variant="display" style={{ fontSize: 26, lineHeight: 38 }}>
                  {title}
                </Text>
                {subtitle ? <Text variant="body">{subtitle}</Text> : null}
              </View>
            ) : null}
          </View>
        ) : null}
        <Body
          className="flex-1"
          {...(scroll
            ? { contentContainerClassName: `px-4 pb-8 gap-3 ${className}`, keyboardShouldPersistTaps: 'handled' as const, showsVerticalScrollIndicator: false }
            : { className: `flex-1 px-4 ${className}` })}
        >
          {children}
        </Body>
        {footer ? <Footer>{footer}</Footer> : null}
      </KeyboardAvoidingView>
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
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
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
                <Text style={{ color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 28, lineHeight: 40 }}>{title}</Text>
                {subtitle ? <Text style={{ color: 'rgba(255,255,255,0.88)', fontSize: 15, lineHeight: 24, fontFamily: fonts.regular }}>{subtitle}</Text> : null}
              </View>
            </View>
          </Hero>
          <View className="gap-4 px-5 pt-2">{children}</View>
        </ScrollView>
        {footer ? <Footer>{footer}</Footer> : null}
      </KeyboardAvoidingView>
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
