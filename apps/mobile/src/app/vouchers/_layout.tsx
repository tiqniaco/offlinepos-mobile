import { Stack } from 'expo-router';
import { stackOptions } from '../../ui/motion';

export default function VouchersLayout() {
  return <Stack screenOptions={stackOptions()} />;
}
