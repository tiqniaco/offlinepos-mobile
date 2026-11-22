import { Stack } from 'expo-router';
import { stackOptions } from '../../ui/motion';

export default function ShiftsLayout() {
  return <Stack screenOptions={stackOptions()} />;
}
