/**
 * Pressable that resolves `style={({ pressed }) => …}` itself and passes a plain style object down.
 * On device, NativeWind's interop dropped function styles (cards lost borders/backgrounds, rows stacked).
 * Every screen imports Pressable from here, not from 'react-native'.
 */
import { forwardRef, useState, type ComponentRef } from 'react';
import { Pressable as RNPressable, type PressableProps, type PressableStateCallbackType, type StyleProp, type ViewStyle } from 'react-native';

type Props = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle> | ((s: PressableStateCallbackType) => StyleProp<ViewStyle>);
  children?: React.ReactNode | ((s: PressableStateCallbackType) => React.ReactNode);
  className?: string;
};

export const Pressable = forwardRef<ComponentRef<typeof RNPressable>, Props>(function Pressable({ style, children, onPressIn, onPressOut, ...rest }, ref) {
  const [pressed, setPressed] = useState(false);
  const state = { pressed, hovered: false } as PressableStateCallbackType;
  return (
    <RNPressable
      ref={ref}
      {...rest}
      onPressIn={(e) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        onPressOut?.(e);
      }}
      style={typeof style === 'function' ? style(state) : style}
    >
      {typeof children === 'function' ? children(state) : children}
    </RNPressable>
  );
});
