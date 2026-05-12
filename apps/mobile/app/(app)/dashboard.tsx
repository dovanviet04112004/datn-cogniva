/**
 * Dashboard screen — minimal placeholder Stage 2 M6 W1.
 *
 * Stage 2 M6 W2-W4 sẽ wire:
 *   - Document list (offline cache với WatermelonDB)
 *   - Daily flashcard count
 *   - Mastery progress chart
 *   - Recent activity feed
 */
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

export default function DashboardScreen() {
  const user = useAuth((s) => s.user);

  const usage = useQuery({
    queryKey: ['account', 'usage'],
    queryFn: async () => {
      const r = await api.account.usage();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.greeting}>
        Xin chào {user?.name ?? user?.email.split('@')[0] ?? 'bạn'}!
      </Text>
      <Text style={styles.plan}>Plan: {user?.plan ?? 'FREE'}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>AI usage hôm nay</Text>
        {usage.isLoading ? (
          <Text style={styles.cardBody}>Đang tải...</Text>
        ) : usage.error ? (
          <Text style={styles.cardError}>Lỗi: {usage.error.message}</Text>
        ) : usage.data ? (
          <>
            <Text style={styles.cardBody}>
              ${(usage.data.spentUsd ?? 0).toFixed(3)} / $
              {(usage.data.quotaUsd ?? 0).toFixed(2)}
            </Text>
            <Text style={styles.cardMeta}>
              Còn lại: ${(usage.data.remainingUsd ?? 0).toFixed(3)}
              {usage.data.resetAt
                ? ` (reset ${new Date(usage.data.resetAt).toLocaleTimeString('vi-VN')})`
                : ''}
            </Text>
          </>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Stage 2 W1 — Mobile bootstrap</Text>
        <Text style={styles.cardBody}>
          App scaffold xong. Document list + flashcard review + chat sẽ wire
          ở M6 W2-W4. Hiện tại bạn có thể đăng ký / đăng nhập / xem usage.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#f5f7fa' },
  container: { padding: 16, gap: 12 },
  greeting: { fontSize: 24, fontWeight: '700', color: '#111' },
  plan: { fontSize: 14, color: '#666', marginBottom: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#111', marginBottom: 6 },
  cardBody: { fontSize: 14, color: '#444', lineHeight: 20 },
  cardMeta: { fontSize: 12, color: '#888', marginTop: 4 },
  cardError: { fontSize: 14, color: '#c00' },
});
