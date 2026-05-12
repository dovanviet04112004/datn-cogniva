/**
 * Push notification client — Expo Notifications wrapper.
 *
 * Stage 2 M6 W4 — M7 (backend wired):
 *   - registerForPushNotificationsAsync(): xin quyền + lấy Expo Push Token
 *   - setNotificationHandler: cấu hình foreground display (banner + sound)
 *   - addNotificationResponseReceivedListener: handle tap notification
 *     → router.push (deep link tới screen tương ứng)
 *   - getCachedPushToken(): trả token gần nhất đã capture (cho sign-out
 *     unregister flow — caller không phải re-request permission)
 *
 * Backend integration (M7 done):
 *   - Root layout `_layout.tsx` `NotificationsBridge` POST token sang
 *     `/api/account/push-token` sau khi user sign-in
 *   - Auth store `signOut()` DELETE token trước khi clear session
 *   - Inngest worker `flashcard-due-reminder.ts` query bảng `push_token`
 *     → batch gửi qua Expo Push API
 *
 * Lý do KHÔNG dùng Firebase Cloud Messaging trực tiếp:
 *   - Expo Push API miễn phí, hỗ trợ cả iOS (APNs) + Android (FCM) qua 1 endpoint
 *   - Token format `ExponentPushToken[xxx]` ổn định, không phụ thuộc EAS Build
 *   - Phù hợp cho MVP / TestFlight beta phase
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

// Phát hiện simulator/emulator qua Constants.executionEnvironment + ownership.
// KHÔNG dùng expo-device để giữ deps mỏng — emulator cases được getExpoPushTokenAsync
// throw catch ở dưới (không có FCM/APNs token).
function isRealDevice(): boolean {
  // Expo Go trên simulator vẫn return ownership === 'expo' → không phân biệt được.
  // Standalone build: `Constants.isDevice` (deprecated) hoặc kiểm executionEnvironment.
  const env = Constants.executionEnvironment;
  // 'storeClient' = Expo Go, 'standalone' = production build, 'bare' = custom
  // Trên emulator standalone vẫn báo 'standalone' → chỉ catch lúc gọi mới biết
  return env !== undefined;
}

// Foreground notification behavior — show banner kể cả khi app đang mở,
// kèm sound + badge. Mặc định Expo silent ở foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false, // App chưa dùng badge count
    shouldShowAlert: true,
  }),
});

// Cache token gần nhất đã capture — module-level singleton, đủ cho mobile
// (1 instance per app process). KHÔNG persist qua SecureStore vì:
//   1. Expo Push Token có thể đổi giữa các session (FCM/APNs rotate)
//   2. Mỗi lần app khởi động, NotificationsBridge tự register lại + update
//      cache → luôn fresh
let cachedToken: string | null = null;

/** Trả về token gần nhất đã capture trong session này (null nếu chưa register). */
export function getCachedPushToken(): string | null {
  return cachedToken;
}

export interface PushRegistrationResult {
  ok: true;
  token: string;
  platform: 'ios' | 'android' | 'web';
}

export interface PushRegistrationError {
  ok: false;
  reason:
    | 'not-a-device'      // emulator/simulator không có push token
    | 'permission-denied' // user từ chối quyền
    | 'no-project-id'     // app.json thiếu EAS projectId
    | 'unknown';
  message: string;
}

/**
 * Request permission + lấy Expo Push Token.
 *
 * Quy trình:
 *   1. Check `Device.isDevice` — emulator/simulator không có FCM/APNs token
 *   2. Yêu cầu permission (chỉ prompt 1 lần — sau đó user phải vào Settings)
 *   3. Android: cần channel default trước khi getExpoPushToken
 *   4. Lấy token qua EAS projectId (từ expo-constants)
 *
 * Lưu ý: KHÔNG block UI — gọi async, để app khởi động trước, fetch token nền.
 */
export async function registerForPushNotificationsAsync(): Promise<
  PushRegistrationResult | PushRegistrationError
> {
  if (!isRealDevice()) {
    return {
      ok: false,
      reason: 'not-a-device',
      message: 'Push notifications chỉ chạy trên thiết bị thật (không phải emulator/simulator).',
    };
  }

  // Android: setup default channel (bắt buộc cho Android 8+, nếu thiếu thì
  // notification show nhưng không có vibration/sound).
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Mặc định',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0066FF',
    });
  }

  // Permission flow — gộp check + ask để giảm round trip
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    return {
      ok: false,
      reason: 'permission-denied',
      message: 'User từ chối quyền thông báo. Có thể bật lại trong Settings.',
    };
  }

  // EAS projectId — BẮT BUỘC cho getExpoPushTokenAsync trên SDK 49+
  // (kể cả Expo Go, anonymous fallback đã bị xoá ở SDK 52+).
  // App.json đang dùng dev UUID — production sẽ thay bằng real EAS projectId
  // qua `eas init`.
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    cachedToken = tokenData.data;
    return {
      ok: true,
      token: tokenData.data,
      platform: Platform.OS as 'ios' | 'android' | 'web',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Common error: "No 'projectId' found" → user chưa setup EAS
    if (msg.includes('projectId')) {
      return {
        ok: false,
        reason: 'no-project-id',
        message:
          'App chưa cấu hình EAS projectId — chạy `eas init` rồi thêm vào app.json (`extra.eas.projectId`).',
      };
    }
    return { ok: false, reason: 'unknown', message: msg };
  }
}

/**
 * Setup listener cho notification tap → trả về unsubscribe function.
 *
 * Payload deep link convention (đồng bộ với backend Inngest worker Stage 3):
 *   { type: 'flashcard-due', cardId: '...' }  → /flashcards
 *   { type: 'room-invite', roomId: '...' }    → /rooms/{roomId}
 *   { type: 'document-ready', docId: '...' }  → /documents/{docId}
 *
 * onNavigate được layout gốc inject (dùng `router.push` từ expo-router).
 */
export function addNotificationTapListener(
  onNavigate: (path: string) => void,
): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as Record<string, unknown>;
    if (!data || typeof data !== 'object') return;

    const type = data.type;
    if (type === 'flashcard-due') {
      onNavigate('/flashcards');
    } else if (type === 'room-invite' && typeof data.roomId === 'string') {
      onNavigate(`/rooms/${data.roomId}`);
    } else if (type === 'document-ready' && typeof data.docId === 'string') {
      onNavigate(`/documents/${data.docId}`);
    }
    // Type khác → bỏ qua (chỉ open app, không navigate)
  });
  return () => sub.remove();
}
