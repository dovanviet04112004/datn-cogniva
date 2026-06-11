import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

function isRealDevice(): boolean {
  const env = Constants.executionEnvironment;
  return env !== undefined;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowAlert: true,
  }),
});

let cachedToken: string | null = null;

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
  reason: 'not-a-device' | 'permission-denied' | 'no-project-id' | 'unknown';
  message: string;
}

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

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Mặc định',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0066FF',
    });
  }

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

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

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

export function addNotificationTapListener(onNavigate: (path: string) => void): () => void {
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
  });
  return () => sub.remove();
}
