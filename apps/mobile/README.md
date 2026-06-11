# @cogniva/mobile — Expo / React Native App

Stage 2 (M6 W4) — đóng khắu mobile: PDF viewer + Deep linking + Push notif setup + EAS profiles.

## Tech stack

- **Expo SDK 54** + Expo Router 6 (file-based routing, `app/` dir)
- **React Native 0.81** + New Architecture (Fabric + TurboModules)
- **Hermes** engine (default, ES2020+)
- **TanStack Query v5** — server state cache + offline-first
- **Zustand** — client state (auth, prefs)
- **expo-secure-store** — token storage (iOS Keychain / Android KeyStore)
- **@cogniva/shared** — types + API client share với web

## Project structure

```
apps/mobile/
├── app/                       # Expo Router file-based routes
│   ├── _layout.tsx            # Root: QueryClient, splash, hydrate
│   ├── index.tsx              # Auto-redirect dựa auth state
│   ├── (auth)/
│   │   ├── _layout.tsx        # Redirect (app) nếu logged in
│   │   ├── sign-in.tsx
│   │   └── sign-up.tsx
│   └── (app)/
│       ├── _layout.tsx        # Tabs + auth guard
│       ├── dashboard.tsx
│       ├── flashcards.tsx     # FSRS review + swipe gestures
│       ├── settings.tsx       # Account + cancel-deletion banner
│       └── documents/
│           ├── _layout.tsx    # Nested Stack
│           ├── index.tsx      # List + upload FAB
│           └── [id].tsx       # Detail (metadata + chunks)
├── src/
│   ├── lib/
│   │   ├── api.ts             # Client singleton (wrap @cogniva/shared)
│   │   ├── notifications.ts   # Expo Push token + tap → deep link
│   │   └── storage.ts         # SecureStore wrapper
│   └── store/
│       └── auth.ts            # Zustand auth store + hydrate
├── app.json                   # Expo config (scheme: cogniva://)
├── babel.config.js            # worklets plugin (Reanimated 4)
├── eas.json                   # Build profiles: dev / preview / prod
├── metro.config.js            # Monorepo workspace resolve
└── tsconfig.json
```

## Development

### First run

```bash
# Cài deps (root)
pnpm install

# Cài Expo Go app trên điện thoại:
#   - iOS: App Store → "Expo Go"
#   - Android: Play Store → "Expo Go"

# Hoặc dùng simulator:
#   - iOS: Xcode → Simulator
#   - Android: Android Studio → Device Manager → AVD

# Copy env
cp apps/mobile/.env.example apps/mobile/.env.local

# Start Metro bundler
pnpm --filter @cogniva/mobile start
```

Sau khi `expo start`, bạn sẽ thấy QR code:

- **iOS:** mở Camera app → scan QR → tap notification → Expo Go mở app
- **Android:** mở Expo Go → "Scan QR code" → quét

### Connect tới Next.js dev server

Vì điện thoại + máy dev khác network, `localhost:3000` KHÔNG work. Có 3 option:

**Option A — Same Wi-Fi:** Set `EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:3000` trong `.env.local`. LAN IP qua `ipconfig` (Windows) hoặc `ifconfig` (Mac/Linux).

**Option B — ngrok tunnel:**

```bash
npm install -g ngrok
ngrok http 3000
# Copy URL https://abc123.ngrok.io vào EXPO_PUBLIC_API_URL
```

**Option C — Edge gateway:** Set `EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:8787` để test luôn full Workers + origin path.

## Build native binaries

Chỉ cần khi submit App Store / Play Store. Local dev KHÔNG cần.

```bash
# Install EAS CLI
npm install -g eas-cli
eas login

# 1) Khởi tạo project trên EAS (chỉ chạy 1 lần) — sẽ ghi projectId vào app.json
eas init

# 2) Dev client cho native module (react-native-pdf, …)
eas build --profile development --platform all

# 3) Internal testing (TestFlight / APK qua link)
eas build --profile preview --platform all

# 4) Production
eas build --profile production --platform all
eas submit --platform ios       # cần submit.production.ios.* trong eas.json
eas submit --platform android   # cần google-service-account.json
```

3 profiles trong `eas.json`:

| Profile       | Distribution          | Channel     | API URL                       |
| ------------- | --------------------- | ----------- | ----------------------------- |
| `development` | internal + dev client | development | `http://localhost:3000`       |
| `preview`     | internal (APK / TF)   | preview     | `https://staging.cogniva.app` |
| `production`  | store                 | production  | `https://cogniva.app`         |

## Deep linking

App scheme: `cogniva://` (đã wire ở `app.json`).

Expo Router tự map URL path → route file:

| Deep link                  | Route file                           |
| -------------------------- | ------------------------------------ |
| `cogniva://flashcards`     | `app/(app)/flashcards.tsx`           |
| `cogniva://documents/{id}` | `app/(app)/documents/[id].tsx`       |
| `cogniva://rooms/{id}`     | `app/(app)/rooms/{id}.tsx` (Stage 3) |

Test deep link trong dev:

```bash
# iOS simulator
xcrun simctl openurl booted "cogniva://documents/abc123"

# Android emulator
adb shell am start -W -a android.intent.action.VIEW -d "cogniva://flashcards" com.cogniva.app
```

## Push notifications

Wire ở `src/lib/notifications.ts`:

- `registerForPushNotificationsAsync()` — xin quyền + lấy Expo Push Token (`ExponentPushToken[xxx]`)
- `addNotificationTapListener(onNavigate)` — tap notif → deep link route

**Hiện tại token chỉ log ra console**. Stage 3 sẽ wire `POST /api/account/push-token` để backend Inngest gửi reminder FSRS / room invite qua Expo Push API.

## Roadmap

- [x] M6 W1: Expo scaffold + auth screens + auth guard
- [x] M6 W1: Shared types + API client extract
- [x] M6 W1: SecureStore token + Zustand auth
- [x] M6 W2: Document list (badge, refresh, file icon)
- [x] M6 W2: Flashcard review với swipe gestures
- [x] M6 W3: Offline cache (React Query persist + AsyncStorage)
- [x] M6 W3: Mobile upload PDF + cancel-deletion banner
- [x] M6 W4: Document detail screen (metadata + chunks browser)
- [x] M6 W4: Push notifications client (token + tap listener)
- [x] M6 W4: Deep linking config (cogniva://)
- [x] M6 W4: eas.json — development / preview / production
- [ ] Stage 3: Native PDF viewer (react-native-pdf — cần dev client)
- [ ] Stage 3: Backend push token persistence (POST /api/account/push-token)
- [ ] Stage 3: Inngest worker gửi FSRS due reminder qua Expo Push API
- [ ] M7 W1: iOS App Store submission
- [ ] M7 W1: Google Play submission

## Known limitations (Stage 2 M6 W1)

- **COPPA flow:** mobile chưa wire DOB picker — minor users bị reject signup với message direct tới web. Wire ở M6 W3.
- **Offline mode:** placeholder, không có WatermelonDB. Sync model TBD.
- **JWT auth:** đợi Better Auth JWT plugin wire ở origin (M4 W3). Hiện tại Bearer token có thể null → API gọi qua cookie nhưng RN không có cookie tự động → broken cho mobile cho tới M4 W3 done.
- **Push notif:** plugin cài rồi nhưng chưa wire APNs cert / FCM credential. M6 W3.
