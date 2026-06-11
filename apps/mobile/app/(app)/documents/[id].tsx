/**
 * Document detail screen — show metadata + chunks browser.
 *
 * Stage 2 M6 W4 scope:
 *   - Fetch document detail từ /api/documents/{id}
 *   - Show metadata (filename, size, pages, status, chunks count)
 *   - Tab "Chunks" list extracted text chunks (read-only)
 *   - Button "Mở web" → open trên browser (PDF viewer thật)
 *
 * Pending W4+:
 *   - Native PDF render qua react-native-pdf (cần EAS dev client, không work
 *     trong Expo Go vì native module)
 *   - Highlight + note inline trên chunk
 */
import { useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { api, getValidAccessToken } from '@/lib/api';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ChunkDTO {
  id: string;
  content: string;
  chunkIndex: number;
  pageStart: number | null;
  pageEnd: number | null;
}

export default function DocumentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const detailQuery = useQuery({
    queryKey: ['documents', 'detail', id],
    queryFn: async () => {
      const r = await api.documents.get(id);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    enabled: !!id,
  });

  // Backend `/api/documents/{id}/chunks` (chưa wire shared API) — fetch trực tiếp.
  // Stage 3 thêm vào shared client.
  const chunksQuery = useQuery({
    queryKey: ['documents', 'chunks', id],
    queryFn: async () => {
      const url = `${process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'}/api/documents/${id}/chunks?limit=50`;
      const token = await getValidAccessToken();
      const res = await fetch(url, {
        credentials: 'omit',
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'x-client-name': 'cogniva-mobile',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { chunks: ChunkDTO[] };
      return data.chunks ?? [];
    },
    enabled: !!id,
  });

  const doc = detailQuery.data;
  const chunks = useMemo(() => chunksQuery.data ?? [], [chunksQuery.data]);

  const openInWeb = () => {
    const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
    void Linking.openURL(`${baseUrl}/documents/${id}`);
  };

  if (detailQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#0066FF" />
      </View>
    );
  }

  if (detailQuery.error || !doc) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>
          {detailQuery.error?.message ?? 'Không load được document'}
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>← Quay lại</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.scroll}
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={2}>
            {doc.filename}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>
              {formatBytes(doc.size)}
              {doc.pageCount ? ` · ${doc.pageCount} trang` : ''}
              {' · '}
              {doc.chunks} chunks
            </Text>
          </View>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor:
                    doc.status === 'READY'
                      ? '#dcfce7'
                      : doc.status === 'PROCESSING'
                        ? '#dbeafe'
                        : doc.status === 'FAILED'
                          ? '#fee2e2'
                          : '#fef3c7',
                },
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  {
                    color:
                      doc.status === 'READY'
                        ? '#166534'
                        : doc.status === 'PROCESSING'
                          ? '#1e40af'
                          : doc.status === 'FAILED'
                            ? '#991b1b'
                            : '#92400e',
                  },
                ]}
              >
                {doc.status}
              </Text>
            </View>
          </View>

          <TouchableOpacity style={styles.webBtn} onPress={openInWeb}>
            <Text style={styles.webBtnText}>📄 Mở PDF trên web</Text>
          </TouchableOpacity>

          <Text style={styles.sectionTitle}>
            Chunks {chunks.length > 0 ? `(${chunks.length})` : ''}
          </Text>
        </View>
      }
      data={chunks}
      keyExtractor={(c) => c.id}
      renderItem={({ item }) => (
        <View style={styles.chunkCard}>
          <View style={styles.chunkHeader}>
            <Text style={styles.chunkIdx}>#{item.chunkIndex + 1}</Text>
            {item.pageStart !== null && (
              <Text style={styles.chunkPage}>
                Trang {item.pageStart}
                {item.pageEnd !== item.pageStart ? `–${item.pageEnd}` : ''}
              </Text>
            )}
          </View>
          <Text style={styles.chunkContent} numberOfLines={6}>
            {item.content}
          </Text>
        </View>
      )}
      ListEmptyComponent={
        chunksQuery.isLoading ? (
          <View style={styles.chunkLoading}>
            <ActivityIndicator color="#0066FF" />
          </View>
        ) : (
          <Text style={styles.emptyChunks}>
            {doc.status === 'READY' ? 'Document chưa có chunks (ingest fail?)' : 'Chunks sẽ xuất hiện khi ingest xong'}
          </Text>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#f5f7fa' },
  content: { paddingBottom: 32 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: '#f5f7fa',
  },
  error: { color: '#c00', fontSize: 14, textAlign: 'center' },
  backLink: { color: '#0066FF', fontSize: 14, fontWeight: '600' },

  header: { padding: 16, gap: 8, backgroundColor: '#fff', marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '700', color: '#111' },
  metaRow: { flexDirection: 'row' },
  metaText: { color: '#666', fontSize: 12 },
  statusRow: { flexDirection: 'row', marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: '600' },

  webBtn: {
    backgroundColor: '#0066FF',
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  webBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#666', marginTop: 16, textTransform: 'uppercase' },

  chunkCard: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 10, padding: 14, borderRadius: 10, gap: 6 },
  chunkHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  chunkIdx: { fontSize: 11, fontWeight: '600', color: '#0066FF' },
  chunkPage: { fontSize: 11, color: '#888' },
  chunkContent: { fontSize: 13, color: '#333', lineHeight: 20 },
  chunkLoading: { padding: 24, alignItems: 'center' },
  emptyChunks: { textAlign: 'center', padding: 24, color: '#888', fontSize: 13 },
});
