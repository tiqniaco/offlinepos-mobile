import { Stack } from 'expo-router';
import { colors } from '../../ui';

export default function ReportsLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper.DEFAULT } }} />;
}
