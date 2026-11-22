# Motion & native feel

- Screens: native-stack (react-native-screens) with the platform's own animation — iOS push with full-screen
  swipe-back; Android iOS-style parallax slide, mirrored for Arabic (`ui/motion.ts`). Auth/lock/main switch: fade.
- Taps: `PressableScale` (Reanimated spring on the UI thread) on buttons, cards, tiles, chips, rows; FAB scales more.
- Haptics vocabulary (`ui/haptics.ts`): select (chips, tabs, segmented), tap (buttons, item added to the cart),
  success (sale, voucher, purchase, backup), error (error toast).
- Cart lines spring in / slide out / reflow (Reanimated layout animations); toasts and bottom sheets spring up over a
  fading backdrop; bottom tabs use the "shift" transition.
- Heavy work (backup encryption, imports) runs in slices with yields, so animations never stutter.

## Sounds
Original synthesized sounds (`apps/mobile/scripts/gen-sounds.mjs` → `assets/sounds/*.wav`, ~80 KB total), played
with expo-audio, mixed with other apps' audio, silent when the iPhone is on silent. Setting: المظهر → الأصوات (on by
default, with a "try" button). Every important action = haptic + sound together (`ui/fx.ts`):

| Action | Sound |
|---|---|
| Barcode read (camera, hardware scanner, purchases, stock count) | `scan` — short scanner beep |
| Barcode not found | `notfound` — two soft low notes + warning haptic |
| Item added from search / quantity + | `add` — tiny pop |
| Quantity − / line removed | `remove` — low tick |
| Sale completed | `sale` — two-bell chime |
| Money received (receipt, cash in, supplier refund) | `cash` — coin ting |
| Saved (purchase, voucher, shift closed, backup, subscription, restore) | `success` — rising pair |
| Error toast / payment error | `error` — soft low buzz |
No sound for taps, chips or navigation (haptics only), so the shop never gets noisy.
