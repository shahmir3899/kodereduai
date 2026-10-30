import { Stack } from 'expo-router';
import { Colors } from '../../../constants/colors';

// A folder under a tab or stack group needs its own layout (see components/nav/FolderStack.tsx).
export default function SchoolLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }} />;
}
