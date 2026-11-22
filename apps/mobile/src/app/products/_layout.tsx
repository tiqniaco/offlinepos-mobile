import { Stack } from 'expo-router';
import { colors } from '../../ui';

export default function ProductsLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper.DEFAULT } }} />;
}
