import { useApp } from './app';
import { BACKGROUND_RESET_MS, isMasked, MASK, maskAmounts, maskMoney, noteAppState, usePrivacy } from './privacy';
import type { SessionUser } from '../domain/auth/users';

const u = (id: string) => ({ id, name: id }) as unknown as SessionUser;
const setHide = (v: boolean) => useApp.setState((s) => ({ settings: { ...s.settings, hideSensitive: v } }));

describe('maskMoney / maskAmounts', () => {
  it('returns •••• only when masked', () => {
    expect(maskMoney('1,250.00 ج.م', true)).toBe(MASK);
    expect(maskMoney('1,250.00 ج.م', false)).toBe('1,250.00 ج.م');
    expect(maskMoney('', false)).toBe('');
  });
  it('masks amounts inside text but keeps quantities and counts', () => {
    expect(maskAmounts('2 × شاي 1,010.50')).toBe(`2 × شاي ${MASK}`);
    expect(maskAmounts('الرصيد -58.40 ج.م')).toBe(`الرصيد ${MASK} ج.م`);
    expect(maskAmounts('3 قطع · 1.5 كجم')).toBe('3 قطع · 1.5 كجم');
  });
  it('uses Latin dots only (no digits in the mask)', () => {
    expect(MASK).not.toMatch(/\d/);
  });
});

describe('privacy store', () => {
  beforeEach(() => {
    useApp.setState({ status: 'ready', user: u('a'), settings: { hideSensitive: true } });
    usePrivacy.setState({ revealed: false, backgroundedAt: null });
  });

  it('masks by default when the setting is on, and never when it is off', () => {
    expect(isMasked()).toBe(true);
    setHide(false);
    expect(isMasked()).toBe(false);
    usePrivacy.getState().toggle();
    expect(isMasked()).toBe(false);
  });

  it('the eye toggles reveal on and off', () => {
    usePrivacy.getState().toggle();
    expect(isMasked()).toBe(false);
    usePrivacy.getState().toggle();
    expect(isMasked()).toBe(true);
  });

  it('hides again when the app locks (manual or auto-lock)', () => {
    usePrivacy.getState().toggle();
    useApp.getState().lock();
    expect(usePrivacy.getState().revealed).toBe(false);
    useApp.getState().unlock(u('a'));
    expect(isMasked()).toBe(true);
  });

  it('hides again when another user takes over', () => {
    usePrivacy.getState().toggle();
    useApp.getState().unlock(u('b'));
    expect(usePrivacy.getState().revealed).toBe(false);
  });

  it('stays revealed on unrelated app updates', () => {
    usePrivacy.getState().toggle();
    useApp.getState().touch();
    useApp.setState((s) => ({ settings: { ...s.settings, sounds: false } }));
    expect(usePrivacy.getState().revealed).toBe(true);
  });

  it('hides again when the setting is switched on', () => {
    setHide(false);
    usePrivacy.setState({ revealed: true });
    setHide(true);
    expect(usePrivacy.getState().revealed).toBe(false);
    expect(isMasked()).toBe(true);
  });

  it('hides again after more than a minute in the background, not after a short switch', () => {
    usePrivacy.getState().toggle();
    noteAppState('background', 1_000);
    noteAppState('active', 1_000 + 30_000);
    expect(usePrivacy.getState().revealed).toBe(true);

    noteAppState('inactive', 100_000);
    noteAppState('background', 120_000); // the first leave time counts
    noteAppState('active', 100_000 + BACKGROUND_RESET_MS + 1);
    expect(usePrivacy.getState().revealed).toBe(false);
    expect(usePrivacy.getState().backgroundedAt).toBeNull();
  });
});
