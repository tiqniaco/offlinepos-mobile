import { Stack } from 'expo-router';
import { colors } from '../../ui';

export default function SalesLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper.DEFAULT } }} />;
}
