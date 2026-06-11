/**
 * Documents tab (list) — list tài liệu user upload.
 *
 * Stage 2 M6 W4 update:
 *   - Tách khỏi `documents.tsx` flat → nested Stack
 *   - Card tap → navigate `/documents/${id}` (detail screen)
 *   - FAB upload PDF giữ nguyên
 *
 * Stage 2 M6 W2 scope (giữ nguyên):
 *   - Fetch documents list qua api.documents.list()
 *   - Pull-to-refresh (RefreshControl) + empty state
 *   - Status badge (UPLOADING/PROCESSING/READY/FAILED) + file type icon
 *
 * Pending Stage 3:
 *   - PDF viewer native (react-native-pdf — cần EAS dev client)
 */
import { useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentDTO } from '@cogniva/shared';

import { api, getValidAccessToken } from '@/lib/api';

const STATUS_COLOR: Record<DocumentDTO['status'], string> = {
  UPLOADING: '#f59e0b',
  PROCESSING: '#3b82f6',
  READY: '#10b981',
  FAILED: '#ef4444',
};

const STATUS_LABEL: Record<DocumentDTO['status'], string> = {
  UPLOADING: 'Đang tải lên',
  PROCESSING: 'Đang xử lý',
  READY: 'Sẵn sàng',
  FAILED: 'Thất bại',
};

/**
 * Map mimeType → icon emoji. Backend trả mimeType chuẩn (application/pdf,
 * application/vnd.openxmlformats-officedocument.wordprocessingml.document, …).
 */
function fileIcon(mimeType: string): string {
  if (mimeType.includes('pdf')) return '📕';
  if (mimeType.includes('word') || mimeType.includes('docx')) return '📘';
  if (mimeType.includes('markdown') || mimeType.includes('md')) return '📝';
  return '📄';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['documents', 'list'],
    queryFn: async () => {
      const r = await api.documents.list();
      if (!r.ok) throw new Error(r.error.message);
      return r.data.documents;
    },
  });

  const items = useMemo(() => query.data ?? [], [query.data]);

  /**
   * Upload flow: DocumentPicker → FormData → POST /api/documents/upload.
   * Backend block-then-ingest synchronously (5-30s) → mobile show busy state.
   */
  const uploadMutation = useMutation({
    mutationFn: async () => {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets || picked.assets.length === 0) {
        throw new Error('CANCELED');
      }
      const asset = picked.assets[0]!;
      const form = new FormData();
      // RN FormData accept { uri, name, type } object cast (không phải standard DOM File)
      form.append('file', {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? 'application/pdf',
      } as unknown as Blob);

      // Upload FormData đi fetch thẳng (không qua shared client) → tự lấy
      // accessToken còn hạn, tránh 401 giữa chừng vì JWT 15'.
      const token = await getValidAccessToken();
      const url = `${process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'}/api/documents/upload`;
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'omit',
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'x-client-name': 'cogniva-mobile',
          // KHÔNG set Content-Type — fetch tự set với boundary cho multipart
        },
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Upload thất bại (HTTP ${res.status})`);
      }
      return (await res.json()) as { id: string; filename: string; status: string };
    },
    onSuccess: (data) => {
      Alert.alert('Upload thành công', `${data.filename} (${data.status})`);
      void qc.invalidateQueries({ queryKey: ['documents', 'list'] });
    },
    onError: (err) => {
      if (err.message === 'CANCELED') return; // user huỷ → silent
      Alert.alert('Upload thất bại', err.message);
    },
  });

  if (query.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" color="#0066FF" />
        <Text style={styles.dim}>Đang tải...</Text>
      </View>
    );
  }

  if (query.error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Lỗi: {query.error.message}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => query.refetch()}>
          <Text style={styles.retryText}>Thử lại</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>Chưa có tài liệu nào</Text>
        <Text style={styles.emptyHint}>Upload PDF từ điện thoại để bắt đầu.</Text>
        <TouchableOpacity
          style={[styles.uploadBtn, uploadMutation.isPending && styles.uploadBtnBusy]}
          onPress={() => uploadMutation.mutate()}
          disabled={uploadMutation.isPending}
        >
          {uploadMutation.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.uploadBtnText}>+ Upload PDF</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <FlatList
        contentContainerStyle={styles.list}
        data={items}
        keyExtractor={(d) => d.id}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching && !query.isLoading}
            onRefresh={() => query.refetch()}
            tintColor="#0066FF"
          />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.7}
            onPress={() => router.push(`/documents/${item.id}` as never)}
          >
            <Text style={styles.icon}>{fileIcon(item.mimeType)}</Text>
            <View style={styles.cardBody}>
              <Text style={styles.title} numberOfLines={1}>
                {item.filename}
              </Text>
              <View style={styles.metaRow}>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: `${STATUS_COLOR[item.status]}20` },
                  ]}
                >
                  <Text style={[styles.statusText, { color: STATUS_COLOR[item.status] }]}>
                    {STATUS_LABEL[item.status]}
                  </Text>
                </View>
                <Text style={styles.meta}>
                  {item.pageCount ? `${item.pageCount} trang · ` : ''}
                  {formatBytes(item.size)}
                  {item.chunks > 0 ? ` · ${item.chunks} chunks` : ''}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity
        style={[styles.fab, uploadMutation.isPending && styles.uploadBtnBusy]}
        onPress={() => uploadMutation.mutate()}
        disabled={uploadMutation.isPending}
      >
        {uploadMutation.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.fabText}>+</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f5f7fa',
    gap: 8,
  },
  dim: { color: '#888', fontSize: 13 },
  error: { color: '#c00', fontSize: 14, textAlign: 'center' },
  empty: { fontSize: 16, color: '#444', fontWeight: '600' },
  emptyHint: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
  },
  list: { padding: 16, gap: 10, backgroundColor: '#f5f7fa', minHeight: '100%' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  icon: { fontSize: 28 },
  cardBody: { flex: 1, gap: 6 },
  title: { fontSize: 15, fontWeight: '600', color: '#111' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meta: { fontSize: 12, color: '#666' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: '600' },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#0066FF',
    borderRadius: 8,
  },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  flex: { flex: 1, backgroundColor: '#f5f7fa' },
  uploadBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#0066FF',
    borderRadius: 10,
    minWidth: 180,
    alignItems: 'center',
  },
  uploadBtnBusy: { opacity: 0.6 },
  uploadBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#0066FF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  fabText: { color: '#fff', fontSize: 28, fontWeight: '400', lineHeight: 32 },
});
