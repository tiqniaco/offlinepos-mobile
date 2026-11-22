import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text } from './Text';
import { Icon } from './Icon';

export function Screen({
  children,
  title,
  back = false,
  scroll = true,
  footer,
  className = '',
}: {
  children: React.ReactNode;
  title?: string;
  back?: boolean;
  scroll?: boolean;
  footer?: React.ReactNode;
  className?: string;
}) {
  const Body = scroll ? ScrollView : View;
  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top', 'bottom']}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {title || back ? (
          <View className="flex-row items-center gap-2 px-4 pb-2 pt-3">
            {back ? (
              <Pressable accessibilityRole="button" accessibilityLabel="back" hitSlop={12} onPress={() => router.back()} className="h-11 w-11 items-center justify-center rounded-full active:bg-paper-sunk">
                <Icon name="back" />
              </Pressable>
            ) : null}
            {title ? <Text variant="title">{title}</Text> : null}
          </View>
        ) : null}
        <Body
          className="flex-1"
          {...(scroll ? { contentContainerClassName: `px-4 pb-6 gap-4 ${className}`, keyboardShouldPersistTaps: 'handled' as const } : { className: `flex-1 px-4 ${className}` })}
        >
          {children}
        </Body>
        {footer ? <View className="gap-2 border-t border-paper-line/70 bg-paper px-4 pb-3 pt-3">{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
