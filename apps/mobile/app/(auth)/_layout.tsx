/**
 * (auth) group layout — wrap sign-in / sign-up.
 *
 * Khi user đã login → redirect về (app). Đối xứng với (app)/_layout.tsx.
 */
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
