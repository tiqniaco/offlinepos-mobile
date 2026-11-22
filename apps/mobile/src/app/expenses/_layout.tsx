import { Stack } from 'expo-router';
import { stackOptions } from '../../ui/motion';

export default function ExpensesLayout() {
  return <Stack screenOptions={stackOptions()} />;
}
