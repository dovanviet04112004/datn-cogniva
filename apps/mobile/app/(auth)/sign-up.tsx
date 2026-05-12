/**
 * Sign-up screen — email + password + DOB + (parent email nếu < 13).
 *
 * COPPA flow đầy đủ:
 *   - DOB bắt buộc → tính tuổi → ≥ 13: tạo account adult ngay.
 *   - DOB < 13 → cần parent email → server gửi consent link → account PENDING.
 *
 * UX: 3 dropdown native cho Ngày / Tháng / Năm (iOS scroll wheel, Android list)
 * thay vì calendar picker — pick năm sinh nhanh hơn nhiều.
 */
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link } from 'expo-router';

import { useAuth } from '@/store/auth';
import { DobPicker, isoFromParts, calculateAge } from '@/components/dob-picker';

const COPPA_AGE_THRESHOLD = 13;
const MIN_SIGNUP_AGE = 5;

export default function SignUpScreen() {
  const signUp = useAuth((s) => s.signUp);
  const busy = useAuth((s) => s.busy);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [dob, setDob] = useState({ day: '', month: '', year: '' });
  const [parentEmail, setParentEmail] = useState('');

  // Tính tuổi realtime để show/hide parent email field
  const age = useMemo(() => {
    const iso = isoFromParts(dob);
    if (!iso) return null;
    return calculateAge(iso);
  }, [dob]);

  const needsParent = age !== null && age < COPPA_AGE_THRESHOLD;

  const onSubmit = async () => {
    if (!email || !password) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập email và mật khẩu.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Mật khẩu yếu', 'Tối thiểu 8 ký tự.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Lỗi', 'Mật khẩu xác nhận không khớp.');
      return;
    }
    const dobIso = isoFromParts(dob);
    if (!dobIso) {
      Alert.alert('Thiếu ngày sinh', 'Vui lòng chọn đủ ngày / tháng / năm sinh.');
      return;
    }
    if (age === null || age < MIN_SIGNUP_AGE) {
      Alert.alert('Tuổi không hợp lệ', `Tuổi tối thiểu ${MIN_SIGNUP_AGE}.`);
      return;
    }
    if (needsParent && !parentEmail.trim()) {
      Alert.alert(
        'Cần email cha mẹ',
        'User dưới 13 tuổi cần nhập email cha mẹ để xin consent theo luật COPPA.',
      );
      return;
    }
    if (
      needsParent &&
      parentEmail.trim().toLowerCase() === email.trim().toLowerCase()
    ) {
      Alert.alert('Lỗi', 'Email cha mẹ phải khác email tài khoản.');
      return;
    }

    try {
      await signUp({
        email: email.trim(),
        password,
        name: name.trim() || undefined,
        dateOfBirth: dobIso,
        parentEmail: needsParent ? parentEmail.trim() : undefined,
      });
    } catch (err) {
      Alert.alert(
        'Đăng ký thất bại',
        err instanceof Error ? err.message : 'Có lỗi xảy ra.',
      );
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Tạo tài khoản 🆕</Text>
        <Text style={styles.subtitle}>Miễn phí, không cần thẻ tín dụng [bundle v2]</Text>

        <TextInput
          style={styles.input}
          placeholder="Họ tên (tùy chọn)"
          placeholderTextColor="#999"
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={styles.input}
          placeholder="email@example.com"
          placeholderTextColor="#999"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
        />

        <Text style={styles.label}>Ngày sinh</Text>
        <DobPicker value={dob} onChange={setDob} />
        <Text style={styles.hint}>
          Cần theo luật COPPA (Mỹ) + GDPR Article 8 (EU). Không hiển thị public.
        </Text>

        {needsParent && (
          <>
            <Text style={[styles.label, { marginTop: 12 }]}>
              Email cha mẹ / người giám hộ
            </Text>
            <TextInput
              style={styles.input}
              placeholder="parent@example.com"
              placeholderTextColor="#999"
              value={parentEmail}
              onChangeText={setParentEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Text style={styles.warningHint}>
              ⚠ Bạn dưới {COPPA_AGE_THRESHOLD} tuổi. Cogniva sẽ gửi link xác
              nhận tới email này. Account sẽ limited (no AI, no upload) cho tới
              khi cha mẹ đồng ý.
            </Text>
          </>
        )}

        <TextInput
          style={[styles.input, { marginTop: 8 }]}
          placeholder="Mật khẩu (≥ 8 ký tự)"
          placeholderTextColor="#999"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
        />
        <TextInput
          style={styles.input}
          placeholder="Nhập lại mật khẩu"
          placeholderTextColor="#999"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
        />

        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Đăng ký</Text>
          )}
        </Pressable>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Đã có tài khoản? </Text>
          <Link href="/(auth)/sign-in">
            <Text style={styles.link}>Đăng nhập</Text>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    padding: 24,
    paddingTop: 60,
    paddingBottom: 40,
    backgroundColor: '#fff',
  },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8, color: '#111' },
  subtitle: { fontSize: 15, color: '#666', marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 6 },
  hint: { fontSize: 11, color: '#888', marginTop: 4, marginBottom: 4 },
  warningHint: {
    fontSize: 12,
    color: '#b45309',
    backgroundColor: '#fef3c7',
    padding: 8,
    borderRadius: 6,
    marginBottom: 8,
    lineHeight: 18,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
    fontSize: 16,
    color: '#111',
  },
  button: {
    height: 48,
    backgroundColor: '#0066FF',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 16 },
  footerText: { color: '#666', fontSize: 14 },
  link: { color: '#0066FF', fontSize: 14, fontWeight: '600' },
});
