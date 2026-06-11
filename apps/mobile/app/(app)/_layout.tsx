import { Redirect, Tabs } from 'expo-router';

import { useAuth } from '@/store/auth';

export default function AppLayout() {
  const user = useAuth((s) => s.user);
  if (!user) return <Redirect href="/(auth)/sign-in" />;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#fff' },
        tabBarActiveTintColor: '#0066FF',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: { backgroundColor: '#fff' },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: 'Trang chính', tabBarLabel: 'Home' }} />
      <Tabs.Screen name="documents" options={{ title: 'Tài liệu', tabBarLabel: 'Tài liệu' }} />
      <Tabs.Screen name="flashcards" options={{ title: 'Flashcards', tabBarLabel: 'Học' }} />
      <Tabs.Screen name="settings" options={{ title: 'Cài đặt', tabBarLabel: 'Tôi' }} />
    </Tabs>
  );
}
