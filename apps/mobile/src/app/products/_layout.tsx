import { Stack } from 'expo-router';
import { stackOptions } from '../../ui/motion';

export default function ProductsLayout() {
  return <Stack screenOptions={stackOptions()} />;
}
