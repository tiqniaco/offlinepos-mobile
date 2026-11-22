import { Platform } from 'react-native';

/** Soft, warm shadows (never grey-blue) — two elevations only, used consistently. */
export const shadow = {
  soft: Platform.select({
    web: { boxShadow: '0 1px 2px rgba(58,46,26,.05), 0 8px 24px rgba(58,46,26,.07)' } as object,
    default: { shadowColor: '#3A2E1A', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  }),
  lifted: Platform.select({
    web: { boxShadow: '0 2px 4px rgba(11,107,99,.10), 0 14px 32px rgba(11,107,99,.20)' } as object,
    default: { shadowColor: '#0B6B63', shadowOpacity: 0.22, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  }),
};
