import { Stack } from 'expo-router';
import { stackOptions } from '../../ui/motion';

export default function PartiesLayout() {
  return <Stack screenOptions={stackOptions()} />;
}
