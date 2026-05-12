/**
 * Documents Stack layout — wrap tab "Tài liệu" thành stack navigator
 * để cho phép navigate sang detail screen [id].tsx.
 *
 * Lý do nested Stack thay vì để thẳng `documents.tsx` tab:
 *   - Expo Router không cho phép vừa có `documents.tsx` vừa có `documents/[id].tsx`
 *     ở cùng cấp (ambiguous route)
 *   - Nested Stack giữ tab bar cha (Tabs) cho list + detail, vẫn có back swipe
 *     trên iOS / back gesture Android
 *
 * Header: ẩn ở list (đã có Tabs header "Tài liệu") nhưng show ở detail
 * để có nút back. Set per-screen trong `options`.
 */
import { Stack } from 'expo-router';

export default function DocumentsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="[id]"
        options={{
          headerShown: true,
          title: 'Chi tiết tài liệu',
          headerBackTitle: 'Tài liệu',
        }}
      />
    </Stack>
  );
}
