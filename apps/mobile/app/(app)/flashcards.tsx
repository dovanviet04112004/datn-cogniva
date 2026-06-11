import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FlashcardDTO } from '@cogniva/shared';

import { api } from '@/lib/api';

type Rating = 1 | 2 | 3 | 4;
type Direction = 'left' | 'right' | 'up' | 'down';

const RATING_LABEL: Record<Rating, string> = {
  1: 'Quên',
  2: 'Khó',
  3: 'Tốt',
  4: 'Dễ',
};

const RATING_COLOR: Record<Rating, string> = {
  1: '#ef4444',
  2: '#f59e0b',
  3: '#10b981',
  4: '#3b82f6',
};

const RATING_HINT: Record<Rating, string> = {
  1: '← Quên',
  2: '↓ Khó',
  3: '→ Tốt',
  4: '↑ Dễ',
};

const SCREEN = Dimensions.get('window');
const SWIPE_THRESHOLD = 80;
const FLY_DISTANCE = SCREEN.width * 1.2;

export default function FlashcardsScreen() {
  const qc = useQueryClient();

  const dueQuery = useQuery({
    queryKey: ['flashcards', 'due'],
    queryFn: async () => {
      const r = await api.flashcards.listDue();
      if (!r.ok) throw new Error(r.error.message);
      return r.data.flashcards;
    },
  });

  const queue = useMemo<FlashcardDTO[]>(() => dueQuery.data ?? [], [dueQuery.data]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const currentCard = queue[idx];

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const flipProgress = useSharedValue(0);

  const reviewMutation = useMutation({
    mutationFn: async (input: { flashcardId: string; rating: Rating }) => {
      const r = await api.flashcards.review(input);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: () => {
      translateX.value = 0;
      translateY.value = 0;
      flipProgress.value = 0;
      setIdx((i) => i + 1);
      setRevealed(false);
    },
    onError: (err) => {
      Alert.alert('Không lưu được đánh giá', err.message);
      translateX.value = withSpring(0);
      translateY.value = withSpring(0);
    },
  });

  const submitRating = (rating: Rating) => {
    if (!currentCard) return;
    reviewMutation.mutate({ flashcardId: currentCard.id, rating });
  };

  const flyAndRate = (rating: Rating, direction: Direction) => {
    'worklet';
    const dx = direction === 'left' ? -FLY_DISTANCE : direction === 'right' ? FLY_DISTANCE : 0;
    const dy = direction === 'up' ? -FLY_DISTANCE : direction === 'down' ? FLY_DISTANCE : 0;
    translateX.value = withTiming(dx, { duration: 250 });
    translateY.value = withTiming(dy, { duration: 250 }, () => {
      runOnJS(submitRating)(rating);
    });
  };

  const flipCard = () => {
    if (!revealed) {
      flipProgress.value = withTiming(1, { duration: 300 });
      setRevealed(true);
    }
  };

  const panGesture = Gesture.Pan()
    .enabled(revealed && !reviewMutation.isPending)
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
    })
    .onEnd(() => {
      const x = translateX.value;
      const y = translateY.value;
      const absX = Math.abs(x);
      const absY = Math.abs(y);

      if (absX < SWIPE_THRESHOLD && absY < SWIPE_THRESHOLD) {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        return;
      }

      if (absX > absY) {
        if (x < 0) flyAndRate(1, 'left');
        else flyAndRate(3, 'right');
      } else {
        if (y < 0) flyAndRate(4, 'up');
        else flyAndRate(2, 'down');
      }
    });

  const tapGesture = Gesture.Tap()
    .enabled(!revealed)
    .onEnd(() => {
      runOnJS(flipCard)();
    });

  const composedGesture = Gesture.Exclusive(panGesture, tapGesture);

  const cardStyle = useAnimatedStyle(() => {
    const rotate = interpolate(translateX.value, [-200, 0, 200], [-15, 0, 15], Extrapolation.CLAMP);
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { rotate: `${rotate}deg` },
      ],
    };
  });

  const overlayStyle = useAnimatedStyle(() => {
    const x = translateX.value;
    const y = translateY.value;
    const absX = Math.abs(x);
    const absY = Math.abs(y);

    let color = 'transparent';
    let intensity = 0;
    if (absX > absY) {
      intensity = Math.min(absX / SWIPE_THRESHOLD, 1);
      color = x < 0 ? RATING_COLOR[1] : RATING_COLOR[3];
    } else if (absY > 0) {
      intensity = Math.min(absY / SWIPE_THRESHOLD, 1);
      color = y < 0 ? RATING_COLOR[4] : RATING_COLOR[2];
    }
    return {
      backgroundColor: color,
      opacity: intensity * 0.25,
    };
  });

  const frontStyle = useAnimatedStyle(() => ({
    opacity: interpolate(flipProgress.value, [0, 0.5, 1], [1, 0, 0], Extrapolation.CLAMP),
  }));
  const backStyle = useAnimatedStyle(() => ({
    opacity: interpolate(flipProgress.value, [0, 0.5, 1], [0, 0, 1], Extrapolation.CLAMP),
  }));

  if (dueQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#0066FF" />
        <Text style={styles.dim}>Đang tải thẻ...</Text>
      </View>
    );
  }

  if (dueQuery.error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Lỗi: {dueQuery.error.message}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => dueQuery.refetch()}>
          <Text style={styles.retryText}>Thử lại</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (queue.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.celebrateIcon}>🎉</Text>
        <Text style={styles.empty}>Không có thẻ nào tới hạn!</Text>
        <Text style={styles.emptyHint}>Tạo flashcards trên web hoặc đợi ngày ôn tập kế tiếp.</Text>
      </View>
    );
  }

  if (!currentCard) {
    return (
      <View style={styles.center}>
        <Text style={styles.celebrateIcon}>✅</Text>
        <Text style={styles.empty}>Xong {queue.length} thẻ!</Text>
        <Text style={styles.emptyHint}>Tốt lắm.</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={() => {
            setIdx(0);
            void qc.invalidateQueries({ queryKey: ['flashcards', 'due'] });
          }}
        >
          <Text style={styles.retryText}>Load lại</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.progress}>
        <Text style={styles.progressText}>
          Thẻ {idx + 1} / {queue.length}
        </Text>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${((idx + 1) / queue.length) * 100}%` }]} />
        </View>
      </View>

      <GestureDetector gesture={composedGesture}>
        <Animated.View style={[styles.card, cardStyle]}>
          <Animated.View style={[styles.overlay, overlayStyle]} pointerEvents="none" />
          <Animated.View style={[styles.cardFace, frontStyle]}>
            <Text style={styles.cardLabel}>Câu hỏi</Text>
            <Text style={styles.cardContent}>{currentCard.front}</Text>
            <Text style={styles.tapHint}>Tap để hiện đáp án</Text>
          </Animated.View>
          <Animated.View style={[styles.cardFace, styles.cardFaceAbs, backStyle]}>
            <Text style={styles.cardLabel}>Đáp án</Text>
            <Text style={styles.cardContent}>{currentCard.back}</Text>
            <Text style={styles.tapHint}>Vuốt → ← ↑ ↓ để đánh giá</Text>
          </Animated.View>
        </Animated.View>
      </GestureDetector>

      {revealed && (
        <View style={styles.ratingRow}>
          {[1, 2, 3, 4].map((r) => {
            const rating = r as Rating;
            return (
              <TouchableOpacity
                key={rating}
                style={[styles.ratingBtn, { backgroundColor: RATING_COLOR[rating] }]}
                onPress={() => {
                  const dir: Direction =
                    rating === 1 ? 'left' : rating === 3 ? 'right' : rating === 4 ? 'up' : 'down';
                  flyAndRate(rating, dir);
                }}
                disabled={reviewMutation.isPending}
              >
                <Text style={styles.ratingLabel}>{RATING_LABEL[rating]}</Text>
                <Text style={styles.ratingHint}>{RATING_HINT[rating]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {reviewMutation.isPending && (
        <View style={styles.savingOverlay}>
          <ActivityIndicator color="#0066FF" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa', padding: 16, gap: 14 },
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
  empty: { fontSize: 18, color: '#111', fontWeight: '700' },
  emptyHint: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  celebrateIcon: { fontSize: 48, marginBottom: 8 },
  progress: { gap: 6 },
  progressText: { fontSize: 12, color: '#666', fontWeight: '500' },
  progressBar: { height: 4, backgroundColor: '#e5e7eb', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: '#0066FF', borderRadius: 2 },
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 24,
    minHeight: 240,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    overflow: 'hidden',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 14,
  },
  cardFace: { alignItems: 'center', gap: 10 },
  cardFaceAbs: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: 24,
    justifyContent: 'center',
  },
  cardLabel: {
    fontSize: 11,
    color: '#888',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardContent: {
    fontSize: 22,
    color: '#111',
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 30,
  },
  tapHint: { fontSize: 12, color: '#aaa', marginTop: 20 },
  ratingRow: { flexDirection: 'row', gap: 6, height: 64 },
  ratingBtn: {
    flex: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  ratingLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
  ratingHint: { color: '#fff', fontSize: 9, opacity: 0.85, marginTop: 2, textAlign: 'center' },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#0066FF',
    borderRadius: 10,
  },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  savingOverlay: {
    position: 'absolute',
    bottom: 80,
    right: 20,
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 10,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
