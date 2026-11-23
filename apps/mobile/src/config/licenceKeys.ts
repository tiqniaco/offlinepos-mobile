/**
 * Ed25519 public keys used to verify licences OFFLINE (PLAN.md §8.1). Two slots allow key rotation
 * without forcing an app update. The "dev" key is accepted only in development builds.
 * Generate production keys with: node apps/api/scripts/gen-licence-key.mjs
 */
import Constants from 'expo-constants';

/** Set at build time from the LICENCE_PUBLIC_KEY variable (printed by the deploy-api workflow): "kid:hex[,kid:hex]". */
function fromBuild(): Record<string, string> {
  const raw = (Constants.expoConfig?.extra as { licencePublicKeys?: string } | undefined)?.licencePublicKeys ?? '';
  const out: Record<string, string> = {};
  for (const part of raw.split(',')) {
    const [kid, hex] = part.trim().split(':');
    if (kid && hex && /^[0-9a-f]{64}$/.test(hex)) out[kid] = hex;
  }
  return out;
}

const PRODUCTION_KEYS: Record<string, string> = fromBuild();

const DEV_KEYS: Record<string, string> = {
  dev: '9266fb073a85bb00d2e8df5a408c6186cfcf525f3a630cec0b849f0eed5f8e17',
};

export const LICENCE_PUBLIC_KEYS: Record<string, string> = __DEV__ ? { ...PRODUCTION_KEYS, ...DEV_KEYS } : PRODUCTION_KEYS;
