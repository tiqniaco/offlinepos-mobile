/**
 * Device integrity token for the server (Play Integrity on Android, App Attest on iOS). Best effort:
 * any failure returns undefined and the action continues (the server decides by policy).
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as AppIntegrity from '@expo/app-integrity';
import { sha256Hex } from '@daftarak/shared';
import { getOrCreateInstallId, getSecret, setSecret } from '../../lib/secure';

const projectNumber = (Constants.expoConfig?.extra as { gcpProjectNumber?: string } | undefined)?.gcpProjectNumber ?? '';
let prepared = false;

export async function integrityToken(purpose: string): Promise<{ platform: 'android' | 'ios'; token: string; requestHash: string; keyId?: string } | undefined> {
  try {
    if (!AppIntegrity.isSupported) return undefined;
    const requestHash = sha256Hex(`${await getOrCreateInstallId()}:${purpose}:${new Date().toISOString().slice(0, 10)}`);
    if (Platform.OS === 'android') {
      if (!projectNumber) return undefined;
      if (!prepared) {
        await AppIntegrity.prepareIntegrityTokenProviderAsync(projectNumber);
        prepared = true;
      }
      return { platform: 'android', token: await AppIntegrity.requestIntegrityCheckAsync(requestHash), requestHash };
    }
    if (Platform.OS === 'ios') {
      let keyId = await getSecret('appattest.keyId');
      if (!keyId) {
        keyId = await AppIntegrity.generateKeyAsync();
        const att = await AppIntegrity.attestKeyAsync(keyId, requestHash);
        await setSecret('appattest.keyId', keyId);
        return { platform: 'ios', token: att, requestHash, keyId };
      }
      return { platform: 'ios', token: await AppIntegrity.generateAssertionAsync(keyId, requestHash), requestHash, keyId };
    }
  } catch {
    /* emulator, Play Services missing, simulator… */
  }
  return undefined;
}
