# Motion & native feel

- Screens: native-stack (react-native-screens) with the platform's own animation — iOS push with full-screen
  swipe-back; Android iOS-style parallax slide, mirrored for Arabic (`ui/motion.ts`). Auth/lock/main switch: fade.
- Taps: `PressableScale` (Reanimated spring on the UI thread) on buttons, cards, tiles, chips, rows; FAB scales more.
- Haptics vocabulary (`ui/haptics.ts`): select (chips, tabs, segmented), tap (buttons, item added to the cart),
  success (sale, voucher, purchase, backup), error (error toast).
- Cart lines spring in / slide out / reflow (Reanimated layout animations); toasts and bottom sheets spring up over a
  fading backdrop; bottom tabs use the "shift" transition.
- Heavy work (backup encryption, imports) runs in slices with yields, so animations never stutter.
