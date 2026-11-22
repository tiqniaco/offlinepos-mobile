import { Stack } from 'expo-router';
import { stackOptions } from '../../ui/motion';

export default function SettingsLayout() {
  return <Stack screenOptions={stackOptions()} />;
}
