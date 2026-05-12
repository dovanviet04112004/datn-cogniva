/**
 * DobPicker — 3 button-as-dropdown cho Ngày / Tháng / Năm.
 *
 * Tại sao tự build:
 *   - RN không có `<select>` cross-platform. `@react-native-picker/picker` chỉ
 *     hỗ trợ iOS scroll wheel + Android dialog → UX không nhất quán.
 *   - Custom Modal + FlatList → đồng nhất iOS/Android, scroll dài, tap chọn nhanh.
 *
 * Format input/output: { day: 'DD', month: 'MM', year: 'YYYY' } (zero-padded
 * string). isoFromParts() merge thành 'YYYY-MM-DD' khi đủ 3 field, hoặc null.
 *
 * Năm sắp xếp DESC (mới nhất trước) — đa số user 10-40 tuổi → ít scroll.
 */
import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export type DobParts = { day: string; month: string; year: string };

const VN_MONTHS = [
  'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
  'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
];

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function daysInMonth(year: number, month: number): number {
  // month 1-12; trick: new Date(y, m, 0) trả ngày cuối tháng m-1
  return new Date(year, month, 0).getDate();
}

/**
 * Merge parts thành ISO date string. Trả null nếu chưa đủ 3 field.
 * Auto-clamp ngày nếu vượt số ngày của tháng/năm (vd 31 + Feb → 28/29).
 */
export function isoFromParts(parts: DobParts): string | null {
  if (!parts.day || !parts.month || !parts.year) return null;
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Math.min(Number(parts.day), daysInMonth(y, m));
  return `${parts.year}-${parts.month}-${pad2(d)}`;
}

/** Tính tuổi tròn năm từ ISO date string. */
export function calculateAge(isoDate: string): number {
  const dob = new Date(isoDate);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

type FieldKey = 'day' | 'month' | 'year';

export function DobPicker({
  value,
  onChange,
}: {
  value: DobParts;
  onChange: (v: DobParts) => void;
}) {
  const [open, setOpen] = useState<FieldKey | null>(null);

  const currentYear = new Date().getFullYear();

  // Days list phụ thuộc month + year (Feb 29 leap year). Nếu chưa chọn → default 31.
  const dayOptions = useMemo(() => {
    const y = value.year ? Number(value.year) : currentYear;
    const m = value.month ? Number(value.month) : 12;
    const max = daysInMonth(y, m);
    return Array.from({ length: max }, (_, i) => ({
      key: pad2(i + 1),
      label: String(i + 1),
    }));
  }, [value.year, value.month, currentYear]);

  const monthOptions = useMemo(
    () => VN_MONTHS.map((label, i) => ({ key: pad2(i + 1), label })),
    [],
  );

  const yearOptions = useMemo(() => {
    const arr: { key: string; label: string }[] = [];
    for (let y = currentYear; y >= currentYear - 120; y--) {
      arr.push({ key: String(y), label: String(y) });
    }
    return arr;
  }, [currentYear]);

  const optionsFor = (field: FieldKey) => {
    if (field === 'day') return dayOptions;
    if (field === 'month') return monthOptions;
    return yearOptions;
  };

  const titleFor = (field: FieldKey) => {
    if (field === 'day') return 'Chọn ngày';
    if (field === 'month') return 'Chọn tháng';
    return 'Chọn năm';
  };

  const select = (field: FieldKey, val: string) => {
    onChange({ ...value, [field]: val });
    setOpen(null);
  };

  const labelFor = (field: FieldKey): string => {
    if (field === 'day') return value.day ? String(Number(value.day)) : 'Ngày';
    if (field === 'month') return value.month ? VN_MONTHS[Number(value.month) - 1]! : 'Tháng';
    return value.year || 'Năm';
  };

  return (
    <>
      <View style={styles.row}>
        {(['day', 'month', 'year'] as FieldKey[]).map((field) => (
          <Pressable
            key={field}
            style={[styles.field, !value[field] && styles.fieldEmpty]}
            onPress={() => setOpen(field)}
          >
            <Text style={[styles.fieldText, !value[field] && styles.fieldTextEmpty]}>
              {labelFor(field)}
            </Text>
            <Text style={styles.chevron}>▾</Text>
          </Pressable>
        ))}
      </View>

      <Modal
        visible={open !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{open ? titleFor(open) : ''}</Text>
              <TouchableOpacity onPress={() => setOpen(null)}>
                <Text style={styles.sheetCancel}>Đóng</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={open ? optionsFor(open) : []}
              keyExtractor={(item) => item.key}
              initialNumToRender={20}
              renderItem={({ item }) => {
                const selected = open ? value[open] === item.key : false;
                return (
                  <TouchableOpacity
                    style={[styles.option, selected && styles.optionSelected]}
                    onPress={() => open && select(open, item.key)}
                  >
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                      {item.label}
                    </Text>
                    {selected && <Text style={styles.checkmark}>✓</Text>}
                  </TouchableOpacity>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  field: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
  },
  fieldEmpty: { borderColor: '#ccc' },
  fieldText: { fontSize: 15, color: '#111', fontWeight: '500' },
  fieldTextEmpty: { color: '#999', fontWeight: '400' },
  chevron: { fontSize: 12, color: '#888' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '70%',
    paddingBottom: 24,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  sheetTitle: { fontSize: 16, fontWeight: '600', color: '#111' },
  sheetCancel: { fontSize: 15, color: '#0066FF' },
  option: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionSelected: { backgroundColor: '#e6efff' },
  optionText: { fontSize: 16, color: '#111' },
  optionTextSelected: { color: '#0066FF', fontWeight: '600' },
  checkmark: { fontSize: 16, color: '#0066FF', fontWeight: '700' },
});
