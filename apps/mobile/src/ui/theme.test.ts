import { buildTheme, PALETTES, cssVars, mix } from './theme';

function luminance(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const contrast = (a: string, b: string) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
};

describe('themes', () => {
  it('TIQNIA is the default palette with the official brand blues', () => {
    expect(PALETTES[0]!.id).toBe('tiqnia');
    const t = buildTheme('tiqnia', 'light');
    expect(t.primary['600']).toBe('#0F4CC7');
    expect(t.primary['500']).toBe('#0866FF');
    expect(t.primary['900']).toBe('#0B1F4D');
    expect(t.paper.DEFAULT).toBe('#F8F9FC');
    expect(t.ink.DEFAULT).toBe('#101828');
  });
  it('building a theme never mutates the palette constants', () => {
    const before = JSON.stringify(PALETTES);
    const t = buildTheme('tiqnia', 'dark');
    t.primary['500'] = '#000000';
    buildTheme('teal', 'comfort');
    expect(JSON.stringify(PALETTES)).toBe(before);
  });
  it.each(PALETTES.map((p) => p.id))('%s: readable text in every mode (WCAG AA ≥ 4.5 for body text)', (id) => {
    for (const mode of ['light', 'dark', 'comfort'] as const) {
      const t = buildTheme(id, mode);
      expect(contrast(t.ink.DEFAULT, t.paper.DEFAULT)).toBeGreaterThanOrEqual(7);
      expect(contrast(t.ink.soft, t.paper.card)).toBeGreaterThanOrEqual(4.5);
      // white text on the primary button
      expect(contrast('#FFFFFF', t.primary['600'])).toBeGreaterThanOrEqual(3);
    }
  });
  it('dark mode has dark surfaces and light text', () => {
    const t = buildTheme('tiqnia', 'dark');
    expect(t.isDark).toBe(true);
    expect(luminance(t.paper.DEFAULT)).toBeLessThan(0.05);
    expect(luminance(t.primary['700'])).toBeGreaterThan(luminance(t.primary['600'])); // 700 = text colour → light
  });
  it('no purple anywhere (hue 260°–320°)', () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      if (d < 0.08) return -1; // grey
      let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
      return h < 0 ? h + 360 : h;
    };
    for (const p of PALETTES) for (const mode of ['light', 'dark', 'comfort'] as const) {
      const t = buildTheme(p.id, mode);
      for (const c of [...Object.values(t.primary), ...t.grad, t.accent.DEFAULT]) {
        const h = hue(c);
        expect(h >= 260 && h <= 320).toBe(false);
      }
    }
  });
  it('produces CSS variables for every Tailwind token', () => {
    const v = cssVars(buildTheme('tiqnia', 'light'));
    expect(v['--c-primary-600']).toBe('15 76 199');
    expect(Object.keys(v)).toEqual(expect.arrayContaining(['--c-paper', '--c-ink-soft', '--c-amber-700', '--c-sky-50']));
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });
});
