/**
 * Settings screen — profile + GDPR rights + sign out.
 *
 * Sections:
 *   - Account info (email, name, plan, COPPA status)
 *   - GDPR Article 20: Export data (request JSON file)
 *   - GDPR Article 17: Delete account (30-day grace + cancel)
 *   - Sign out
 *
 * Backend endpoints (đã wire Stage 1):
 *   - POST /api/account/export → trả URL JSON dump
 *   - POST /api/account/delete → đánh dấu PENDING + scheduledFor (now + 30d)
 *   - DELETE /api/account/delete → cancel pending request
 *   - Cron Inngest 03:00 UTC pickup PENDING + hard delete
 */
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

const PLAN_LABEL: Record<string, string> = {
  FREE: 'FREE',
  PRO: 'PRO',
  TEAM: 'TEAM',
  ENTERPRISE: 'ENTERPRISE',
};

const COPPA_LABEL: Record<string, string> = {
  NOT_REQUIRED: '—',
  PENDING: 'Đang chờ cha mẹ',
  VERIFIED: 'Đã xác nhận',
  REJECTED: 'Bị từ chối',
};

export default function SettingsScreen() {
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);
  const qc = useQueryClient();

  // Poll deletion status — nếu user trong grace period sẽ thấy banner cancel
  const deleteStatusQuery = useQuery({
    queryKey: ['account', 'delete-status'],
    queryFn: async () => {
      const r = await api.account.deleteStatus();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const r = await api.account.cancelDelete();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: () => {
      Alert.alert('Đã huỷ yêu cầu xoá', 'Account của bạn an toàn rồi.');
      void qc.invalidateQueries({ queryKey: ['account', 'delete-status'] });
    },
    onError: (err) => {
      Alert.alert('Không huỷ được', err.message);
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const r = await api.account.export();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: (data) => {
      Alert.alert(
        'Đã yêu cầu export',
        `Link download:\n${data.url}\n\n(Mở web để tải file JSON đầy đủ. M6 W3 sẽ wire download + share trên mobile.)`,
      );
    },
    onError: (err) => {
      Alert.alert('Export thất bại', err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const r = await api.account.requestDelete();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: (data) => {
      const scheduledDate = new Date(data.scheduledFor).toLocaleDateString('vi-VN');
      Alert.alert(
        'Đã yêu cầu xoá account',
        `Account sẽ bị xoá vĩnh viễn vào ${scheduledDate} (30 ngày grace period).\n\nHủy bằng cách sign-in lại trong vòng 30 ngày → vào Settings → Cancel deletion.`,
      );
      // Sign out để user không tiếp tục dùng account đang chờ xoá
      void signOut();
    },
    onError: (err) => {
      Alert.alert('Yêu cầu xoá thất bại', err.message);
    },
  });

  const confirmDelete = () => {
    Alert.alert(
      'Xoá account?',
      'Toàn bộ tài liệu, flashcards, lịch sử học sẽ bị xoá VĨNH VIỄN sau 30 ngày (GDPR Article 17). Không thể khôi phục sau khi grace period kết thúc.\n\nBạn chắc chắn?',
      [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: 'Yêu cầu xoá',
          style: 'destructive',
          onPress: () => deleteMutation.mutate(),
        },
      ],
    );
  };

  const confirmSignOut = () => {
    Alert.alert('Đăng xuất', 'Bạn có chắc muốn đăng xuất?', [
      { text: 'Huỷ', style: 'cancel' },
      {
        text: 'Đăng xuất',
        style: 'destructive',
        onPress: () => {
          void signOut();
        },
      },
    ]);
  };

  const pendingDeletion =
    deleteStatusQuery.data && 'pending' in deleteStatusQuery.data && deleteStatusQuery.data.pending
      ? deleteStatusQuery.data
      : null;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      {/* Pending deletion banner — ưu tiên top, action confirm */}
      {pendingDeletion && (
        <View style={styles.pendingBanner}>
          <Text style={styles.pendingTitle}>⚠ Account đang chờ xoá</Text>
          <Text style={styles.pendingText}>
            Còn {pendingDeletion.daysRemaining} ngày trước khi xoá vĩnh viễn.
            Lịch xoá: {new Date(pendingDeletion.scheduledFor).toLocaleDateString('vi-VN')}.
          </Text>
          {pendingDeletion.canCancel && (
            <Pressable
              style={[styles.cancelBtn, cancelMutation.isPending && styles.actionBtnBusy]}
              onPress={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              <Text style={styles.cancelBtnText}>Huỷ yêu cầu xoá</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Account info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Tài khoản</Text>
        <Row label="Email" value={user?.email ?? '—'} />
        {user?.name && <Row label="Tên" value={user.name} />}
        <Row label="Plan" value={PLAN_LABEL[user?.plan ?? 'FREE'] ?? 'FREE'} />
        {user?.parentalConsentStatus && user.parentalConsentStatus !== 'NOT_REQUIRED' && (
          <Row label="COPPA" value={COPPA_LABEL[user.parentalConsentStatus] ?? user.parentalConsentStatus} />
        )}
      </View>

      {/* GDPR Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quyền dữ liệu (GDPR)</Text>
        <Pressable
          style={[styles.actionBtn, exportMutation.isPending && styles.actionBtnBusy]}
          onPress={() => exportMutation.mutate()}
          disabled={exportMutation.isPending}
        >
          <View style={styles.actionTextWrap}>
            <Text style={styles.actionTitle}>Export dữ liệu</Text>
            <Text style={styles.actionSub}>
              Article 20 — tải toàn bộ data (JSON)
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

      {/* Sign out */}
      <Pressable style={styles.signOutBtn} onPress={confirmSignOut}>
        <Text style={styles.signOutText}>Đăng xuất</Text>
      </Pressable>

      {/* Danger zone */}
      <View style={[styles.section, styles.danger]}>
        <Text style={styles.dangerTitle}>Vùng nguy hiểm</Text>
        <Text style={styles.dangerHint}>
          Yêu cầu xoá account vĩnh viễn theo GDPR Article 17. Có 30 ngày grace period để
          khôi phục bằng cách sign-in lại.
        </Text>
        <Pressable
          style={[styles.dangerBtn, deleteMutation.isPending && styles.actionBtnBusy]}
          onPress={confirmDelete}
          disabled={deleteMutation.isPending}
        >
          <Text style={styles.dangerBtnText}>Xoá account</Text>
        </Pressable>
      </View>

      <Text style={styles.footer}>Cogniva Mobile v0.1.0 · Stage 2 M6 W2</Text>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1} ellipsizeMode="tail">
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#f5f7fa' },
  container: { padding: 16, gap: 14, paddingBottom: 32 },
  section: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 8 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 12,
  },
  rowLabel: { color: '#666', fontSize: 14 },
  // flex: 1 + textAlign right → value chiếm width còn lại, ellipsis nếu quá dài
  rowValue: { color: '#111', fontSize: 14, fontWeight: '500', flex: 1, textAlign: 'right' },

  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  actionBtnBusy: { opacity: 0.5 },
  actionTextWrap: { flex: 1, gap: 2 },
  actionTitle: { color: '#0066FF', fontSize: 15, fontWeight: '600' },
  actionSub: { color: '#888', fontSize: 12 },
  chevron: { color: '#ccc', fontSize: 22 },

  signOutBtn: {
    height: 44,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: { color: '#0066FF', fontSize: 15, fontWeight: '600' },

  danger: { borderColor: '#fecaca', borderWidth: 1, backgroundColor: '#fff7f7' },
  dangerTitle: { color: '#c00', fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },
  dangerHint: { color: '#9a3838', fontSize: 12, lineHeight: 18 },
  dangerBtn: {
    backgroundColor: '#dc2626',
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  dangerBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  footer: { textAlign: 'center', color: '#aaa', fontSize: 11, marginTop: 16 },

  pendingBanner: {
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  pendingTitle: { fontSize: 14, fontWeight: '700', color: '#92400e' },
  pendingText: { fontSize: 13, color: '#78350f', lineHeight: 18 },
  cancelBtn: {
    backgroundColor: '#0066FF',
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  cancelBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
