/**
 * The live colour tokens. ONE mutable object: components read `colors.x.y` at render time and
 * `applyTheme()` (./themeStore) rewrites it in place. Never copy values into module-level constants.
 */
import { buildTheme, type ThemeColors } from './theme';

const colors: ThemeColors = buildTheme('tiqnia', 'light');
export default colors;
export { colors };
