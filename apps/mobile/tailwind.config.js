const colors = require('./src/ui/colors.json');

/** Design tokens (PLAN.md §3.5): warm paper base, teal primary, amber accent. No purple anywhere. */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  // Dark mode (Phase 7) will be switched by the app, not by the OS media query.
  darkMode: 'class',
  theme: {
    extend: {
      colors,
      fontFamily: {
        sans: ['IBMPlexSansArabic_400Regular'],
        medium: ['IBMPlexSansArabic_500Medium'],
        semibold: ['IBMPlexSansArabic_600SemiBold'],
        bold: ['IBMPlexSansArabic_700Bold'],
      },
      borderRadius: { card: '16px', field: '12px' },
      fontSize: { tiny: ['12px', '18px'], body: ['15px', '24px'], title: ['20px', '30px'], display: ['28px', '40px'] },
    },
  },
  plugins: [],
};
