import { Redirect } from 'expo-router';

import { useAuth } from '@/store/auth';

export default function Index() {
  const user = useAuth((s) => s.user);
  const hydrating = useAuth((s) => s.hydrating);

  if (hydrating) return null;
  if (user) return <Redirect href="/(app)/dashboard" />;
  return <Redirect href="/(auth)/sign-in" />;
}
