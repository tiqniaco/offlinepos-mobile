import Constants from 'expo-constants';
import * as Application from 'expo-application';

export const API_URL: string = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? 'http://10.0.2.2:8787';
export const APP_VERSION: string = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0';
