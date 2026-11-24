/** «اخفِ التطبيق في قائمة التطبيقات المفتوحة» rules (pure; see AppSwitcherCover). */
type State = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

/** Default on (never saved → on). */
export const coverEnabled = (v: boolean | undefined) => v !== false;

export function shouldCover(enabled: boolean, state: State, held: boolean): boolean {
  if (!enabled || state === 'active') return false;
  return state === 'background' || !held;
}
