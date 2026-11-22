import { PermissionsAndroid, Platform } from 'react-native';
import { PrintError } from './types';

/** Android 12+: BLUETOOTH_SCAN + BLUETOOTH_CONNECT; Android ≤ 11: location for scanning. iOS: system prompt. */
export async function ensureBluetoothPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const api = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  const perms =
    api >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const res = await PermissionsAndroid.requestMultiple(perms);
  if (!Object.values(res).every((r) => r === PermissionsAndroid.RESULTS.GRANTED)) throw new PrintError('permission');
}
