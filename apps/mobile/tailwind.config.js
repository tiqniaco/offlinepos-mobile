/**
 * Colours are CSS variables set by the theme (src/ui/theme.ts → cssVars), so every NativeWind class
 * follows the chosen palette and light/dark/comfort mode. `primary` = brand scale (TIQNIA blue by default).
 */
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
const scale = (name, keys) => Object.fromEntries(keys.map((k) => [k, v(`${name}-${k}`)]));
const FULL = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
const SMALL = ['50', '100', '300', '500', '600', '700'];

// Fonts are NOT Tailwind classes: they follow the user's choice via src/ui/fonts.ts (Text sets fontFamily).
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  // Dark mode is driven by the app's own theme setting (not the OS media query).
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        paper: { DEFAULT: v('paper'), card: v('paper-card'), sunk: v('paper-sunk'), line: v('paper-line') },
        ink: { DEFAULT: v('ink'), soft: v('ink-soft'), mute: v('ink-mute'), faint: v('ink-faint') },
        accent: v('accent'),
        primary: scale('primary', FULL),
        amber: scale('amber', SMALL),
        rose: scale('rose', SMALL),
        leaf: scale('leaf', SMALL),
        sky: scale('sky', SMALL),
      },
      borderRadius: { card: '16px', field: '12px' },
      fontSize: { tiny: ['12px', '18px'], body: ['15px', '24px'], title: ['20px', '30px'], display: ['28px', '40px'] },
    },
  },
  plugins: [],
};
