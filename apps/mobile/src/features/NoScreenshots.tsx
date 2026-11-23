/** Blocks screenshots / screen recording on sensitive screens when the owner turned it on (القفل والأمان). */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { useApp } from '../state/app';

export function useNoScreenshots(id: string) {
  const on = useApp((s) => !!s.settings.blockScreenshots);
  useEffect(() => {
    if (!on || Platform.OS === 'web') return;
    void ScreenCapture.preventScreenCaptureAsync(id).catch(() => undefined);
    return () => void ScreenCapture.allowScreenCaptureAsync(id).catch(() => undefined);
  }, [on, id]);
}

export function NoScreenshots({ id }: { id: string }) {
  useNoScreenshots(id);
  return null;
}
