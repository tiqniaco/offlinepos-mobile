import { Stack } from 'expo-router';
import { stackOptions } from '../../ui/motion';

export default function SalesLayout() {
  return <Stack screenOptions={stackOptions()} />;
}
