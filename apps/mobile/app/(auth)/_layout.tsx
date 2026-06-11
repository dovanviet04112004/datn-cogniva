import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/store/auth';

export default function AuthLayout() {
  const user = useAuth((s) => s.user);
  if (user) return <Redirect href="/(app)/dashboard" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#fff' },
      }}
    />
  );
}
