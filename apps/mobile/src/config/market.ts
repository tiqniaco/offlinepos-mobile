/** Launch market. Egypt only for now (owner decision 2026-11); Saudi support stays in the code, hidden. */
export const EGYPT_ONLY = true;

/** E.164 without "+": Egyptian mobiles are 2010/2011/2012/2015 + 8 digits. */
export const isEgyptianMobile = (e164: string) => /^20(10|11|12|15)\d{8}$/.test(e164);
