import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useAuth } from '@/store/auth';
import { api } from '@/lib/api';
import { addNotificationTapListener, registerForPushNotificationsAsync } from '@/lib/notifications';

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'cogniva.query-cache',
  throttleTime: 1000,
});

function NotificationsBridge() {
  const router = useRouter();
  const user = useAuth((s) => s.user);

  useEffect(() => {
    if (!user) return;

    void registerForPushNotificationsAsync().then(async (res) => {
      if (!res.ok) {
        console.log('[push] register failed:', res.reason, '-', res.message);
        return;
      }
      console.log('[push] token =', res.token, '(platform:', res.platform, ')');

      const reg = await api.account.registerPushToken({
        token: res.token,
        platform: res.platform,
      });
      if (!reg.ok) {
        console.log('[push] backend register failed:', reg.error.message);
      } else {
        console.log('[push] backend register OK:', reg.data.action);
      }
    });

    const unsubscribe = addNotificationTapListener((path) => {
      router.push(path as never);
    });
    return unsubscribe;
  }, [user, router]);

  return null;
}

export default function RootLayout() {
  const hydrate = useAuth((s) => s.hydrate);
  const hydrating = useAuth((s) => s.hydrating);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrating) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [hydrating]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: 24 * 60 * 60 * 1000,
          buster: 'v1',
        }}
      >
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerShown: false,
          }}
        >
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
        </Stack>
        <NotificationsBridge />
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}
