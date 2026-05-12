/**
 * Root layout — Expo Router. Wrap toàn bộ app.
 *
 * Responsibilities:
 *   1. Hydrate auth state từ SecureStore khi boot
 *   2. Show splash screen tới khi hydrate xong
 *   3. QueryClient provider với offline cache persist (AsyncStorage)
 *   4. Status bar config
 *
 * Offline cache (Stage 2 M6 W3):
 *   - PersistQueryClientProvider lưu cache TanStack Query → AsyncStorage
 *   - App reopen offline → cache restore → render data ngay (stale-while-revalidate)
 *   - Online lại → query refetch background, UI update khi xong
 *   - Cache TTL 24h (maxAge) — sau đó force refetch
 *
 * Auth redirect chạy ở (app)/_layout.tsx (protected group) và (auth)/_layout.tsx
 * — KHÔNG ở root vì root cần render trước khi redirect (Expo Router rule).
 */
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
import {
  addNotificationTapListener,
  registerForPushNotificationsAsync,
} from '@/lib/notifications';

// Giữ splash hiển thị tới khi hydrate xong (tránh nhấp nháy trắng).
SplashScreen.preventAutoHideAsync().catch(() => {
  // Đã hidden — ignore
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,           // 30s — phù hợp dashboard, document list
      gcTime: 24 * 60 * 60 * 1000, // 24h — cache giữ trong AsyncStorage tối đa 1 ngày
      refetchOnWindowFocus: false, // RN không có window focus
    },
  },
});

/**
 * AsyncStorage persister — serialize cache TanStack Query thành JSON,
 * lưu vào key `cogniva.query-cache`. Tối đa ~6MB (AsyncStorage Android limit
 * theo từng key, nhưng cao hơn nhiều nếu cache config tốt).
 */
const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'cogniva.query-cache',
  // Throttle persist: max 1 write / 1s → tránh ghi liên tục khi user navigate
  throttleTime: 1000,
});

/**
 * NotificationsBridge — child component để dùng `useRouter` (chỉ available
 * trong navigation context, tức bên trong `<Stack>`). Register push token +
 * lắng nghe tap notification → router.push deep link.
 *
 * Chạy 1 lần khi mount, cleanup unsubscribe khi unmount root.
 */
function NotificationsBridge() {
  const router = useRouter();
  const user = useAuth((s) => s.user);

  useEffect(() => {
    // Chỉ register sau khi user đã đăng nhập — chưa login thì notif không có
    // context (deep link tới /flashcards → bị redirect về /sign-in luôn)
    if (!user) return;

    void registerForPushNotificationsAsync().then(async (res) => {
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.log('[push] register failed:', res.reason, '-', res.message);
        return;
      }
      // eslint-disable-next-line no-console
      console.log('[push] token =', res.token, '(platform:', res.platform, ')');

      // M7: gửi token lên backend để Inngest worker query khi đẩy notif.
      // Idempotent — gọi mỗi lần app khởi động chỉ bump `lastSeenAt`.
      const reg = await api.account.registerPushToken({
        token: res.token,
        platform: res.platform,
      });
      if (!reg.ok) {
        // eslint-disable-next-line no-console
        console.log('[push] backend register failed:', reg.error.message);
      } else {
        // eslint-disable-next-line no-console
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
          maxAge: 24 * 60 * 60 * 1000, // 24h
          // Buster: bump version khi schema API đổi để invalidate cache cũ
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
