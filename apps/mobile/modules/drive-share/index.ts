import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

type Native = { isDriveInstalled(): boolean; sendToDrive(contentUri: string, mime: string, title: string): boolean };

// Android only. Elsewhere (iOS, web, tests) the app falls back to the share sheet.
const native: Native | null = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('DriveShare') : null;

export const isDriveInstalled = (): boolean => {
  try {
    return !!native?.isDriveInstalled();
  } catch {
    return false;
  }
};

/** Opens Google Drive's "Upload" screen with this file. False when Drive is missing or refused. */
export function sendToDrive(contentUri: string, mime: string, title: string): boolean {
  try {
    return !!native?.sendToDrive(contentUri, mime, title);
  } catch {
    return false;
  }
}
