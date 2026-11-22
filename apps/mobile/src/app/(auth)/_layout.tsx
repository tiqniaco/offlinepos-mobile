import { Stack } from 'expo-router';
import { stackOptions } from '../../ui/motion';

export default function AuthLayout() {
  return <Stack screenOptions={stackOptions()} />;
}
