/**
 * Form sign-up — Client Component, validation đầy đủ trước khi gửi backend.
 *
 * COPPA compliance (Plan v2 §3.7.2):
 *   - Bắt buộc DOB.
 *   - Nếu < 13: hiện thêm field email cha mẹ + warning về limited account.
 *   - Backend hook (lib/auth.ts) validate lại + send consent email.
 *
 * Khác sign-in:
 *  - Có thêm name, DOB, optional parent email.
 *  - Sau submit, autoSignIn của Better Auth tự đăng nhập → redirect /dashboard.
 *  - Nếu < 13: redirect /coppa-pending (informational page về consent).
 *
 * Quy tắc password: ≥ 8 ký tự + ≤ 72 ký tự (bcrypt limit).
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { Info, Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { signUp } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
// ComboSelect — dropdown gõ-để-lọc thay 3 <select> native Day/Month/Year.
import { ComboSelect } from '@/components/ui/combo-select';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

const COPPA_AGE_THRESHOLD = 13;
const MIN_SIGNUP_AGE = 5;

/** Tính tuổi tròn năm từ DOB string (YYYY-MM-DD từ input[type=date]). */
function calculateAge(dobString: string): number {
  const dob = new Date(dobString);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

const schema = z
  .object({
    name: z.string().min(1, 'Name is required.').max(80),
    email: z.string().email('Enter a valid email address.'),
    dateOfBirth: z
      .string()
      .min(1, 'Ngày sinh là bắt buộc.')
      .refine((s) => !Number.isNaN(new Date(s).getTime()), 'Ngày sinh không hợp lệ.')
      .refine((s) => new Date(s).getTime() < Date.now(), 'Ngày sinh không thể ở tương lai.')
      .refine((s) => calculateAge(s) >= MIN_SIGNUP_AGE, `Tuổi tối thiểu ${MIN_SIGNUP_AGE}.`),
    parentEmail: z.string().email('Email cha mẹ không hợp lệ.').optional().or(z.literal('')),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters.')
      // 72 byte là giới hạn của bcrypt — vượt quá sẽ bị truncate âm thầm
      .max(72, 'Password must be 72 characters or fewer.'),
    confirmPassword: z.string(),
  })
  // Cross-field: passwords match
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })
  // Cross-field: nếu < 13 → parentEmail required
  .refine(
    (data) =>
      calculateAge(data.dateOfBirth) >= COPPA_AGE_THRESHOLD ||
      (data.parentEmail && data.parentEmail.length > 0),
    {
      message: 'User dưới 13 tuổi cần nhập email cha mẹ để consent.',
      path: ['parentEmail'],
    },
  )
  // Parent email không trùng email user
  .refine(
    (data) =>
      !data.parentEmail || data.parentEmail.toLowerCase() !== data.email.toLowerCase(),
    {
      message: 'Email cha mẹ phải khác email tài khoản.',
      path: ['parentEmail'],
    },
  );

type FormValues = z.infer<typeof schema>;

// ─────────────────────────────────────────────────────────────────────
// DobSelect — 3 native <select> Day / Month / Year.
//
// Lý do KHÔNG dùng <input type="date">:
//   - Android Chrome: calendar picker mở vào tháng hiện tại → user phải bấm
//     mũi tên hàng chục lần lùi tới năm sinh (cực tệ cho người 1990s/2000s).
//   - iOS Safari: scroll wheel OK nhưng vẫn tốn step.
//   - Dropdown native Year cho phép scroll/jump nhanh tới đúng năm.
//
// Format giá trị: ISO "YYYY-MM-DD" để giữ tương thích Zod schema + backend.
// Khi user chưa chọn đủ 3 field → emit chuỗi rỗng (Zod báo required).
// ─────────────────────────────────────────────────────────────────────
const VN_MONTHS = [
  'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
  'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
];

function daysInMonth(year: number, month: number): number {
  // month 1-12. new Date(y, m, 0) trả về ngày cuối tháng (m-1).
  return new Date(year, month, 0).getDate();
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function DobSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  // Local state cho selection chưa đủ 3 phần — KHÔNG derive thuần từ `value`
  // (parent) vì khi chỉ pick 1 select, onChange('') sẽ wipe luôn UI.
  // Init từ value nếu form prefilled (vd edit profile sau này).
  const [parts, setParts] = React.useState<{ day: string; month: string; year: string }>(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    return m ? { year: m[1]!, month: m[2]!, day: m[3]! } : { day: '', month: '', year: '' };
  });

  // Year list: từ năm hiện tại lùi 120 năm. Order DESC (mới nhất trước) vì
  // đa số user là tuổi 10-40 → năm gần đây ở top tiết kiệm scroll.
  const currentYear = new Date().getFullYear();
  const years = React.useMemo(() => {
    const arr: number[] = [];
    for (let y = currentYear; y >= currentYear - 120; y--) arr.push(y);
    return arr;
  }, [currentYear]);

  // Days list phụ thuộc month + year (Feb 29 leap year).
  const days = React.useMemo(() => {
    const y = parts.year ? Number(parts.year) : currentYear;
    const m = parts.month ? Number(parts.month) : 12; // default 31 ngày
    const max = daysInMonth(y, m);
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [parts.year, parts.month, currentYear]);

  const emit = (next: { day?: string; month?: string; year?: string }) => {
    const merged = { ...parts, ...next };
    setParts(merged);
    if (merged.day && merged.month && merged.year) {
      // Clamp day theo max của tháng/năm mới (Feb 29 → Feb 28 nếu không nhuận).
      const clampedDay = Math.min(
        Number(merged.day),
        daysInMonth(Number(merged.year), Number(merged.month)),
      );
      onChange(`${merged.year}-${merged.month}-${pad2(clampedDay)}`);
    } else {
      // Chưa đủ 3 field → form value rỗng (Zod sẽ báo "Ngày sinh là bắt buộc"
      // khi submit, nhưng UI vẫn nhớ lựa chọn dở qua local state).
      onChange('');
    }
  };

  // 3 ComboSelect Day/Month/Year — value vẫn là string (pad2), <option value=""
  // disabled> placeholder chuyển sang prop `placeholder`. Giữ NGUYÊN emit() để
  // merge/clamp ngày theo tháng+năm như cũ.
  return (
    <div className="grid grid-cols-3 gap-2">
      <ComboSelect
        value={parts.day}
        onChange={(v) => emit({ day: v })}
        options={days.map((d) => ({ value: pad2(d), label: String(d) }))}
        placeholder="Ngày"
      />
      <ComboSelect
        value={parts.month}
        onChange={(v) => emit({ month: v })}
        options={VN_MONTHS.map((label, i) => ({ value: pad2(i + 1), label }))}
        placeholder="Tháng"
      />
      <ComboSelect
        value={parts.year}
        onChange={(v) => emit({ year: v })}
        options={years.map((y) => ({ value: String(y), label: String(y) }))}
        placeholder="Năm"
      />
    </div>
  );
}

export function SignUpForm({ redirectTo = '/dashboard' }: { redirectTo?: string } = {}) {
  const router = useRouter();
  const [isPending, setIsPending] = React.useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      email: '',
      dateOfBirth: '',
      parentEmail: '',
      password: '',
      confirmPassword: '',
    },
  });

  // Watch DOB → show/hide parent email field
  const dobValue = form.watch('dateOfBirth');
  const showParentField = React.useMemo(() => {
    if (!dobValue) return false;
    try {
      return calculateAge(dobValue) < COPPA_AGE_THRESHOLD;
    } catch {
      return false;
    }
  }, [dobValue]);

  const onSubmit = async (values: FormValues) => {
    setIsPending(true);
    const age = calculateAge(values.dateOfBirth);
    const requiresConsent = age < COPPA_AGE_THRESHOLD;

    const { error } = await signUp.email({
      email: values.email,
      password: values.password,
      name: values.name,
      // additionalFields — Better Auth pass thẳng sang user.create hook
      ...({
        dateOfBirth: values.dateOfBirth,
        parentEmail: requiresConsent ? values.parentEmail : undefined,
      } as Record<string, unknown>),
    } as Parameters<typeof signUp.email>[0]);

    if (error) {
      setIsPending(false);
      toast.error(error.message ?? 'Could not create your account.');
      return;
    }

    if (requiresConsent) {
      toast.info(
        'Đã gửi email confirm cho cha mẹ. Tài khoản sẽ limited cho tới khi parent verify.',
        { duration: 8000 },
      );
      router.push('/coppa-pending');
      router.refresh();
      return;
    }

    toast.success('Account created. Welcome to Cogniva!');

    // Đọc redirect param fresh từ URL (phòng prop stale) — safe-check path
    const url = new URL(window.location.href);
    const freshRedirect = url.searchParams.get('redirect') ?? redirectTo;
    const safeRedirect = freshRedirect.startsWith('/') && !freshRedirect.startsWith('//')
      ? freshRedirect
      : '/dashboard';

    // Full reload đảm bảo cookie session vừa set được browser commit + RSC
    // server component fetch lại session mới.
    window.location.replace(safeRedirect);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input autoComplete="name" placeholder="Ada Lovelace" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="dateOfBirth"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Ngày sinh</FormLabel>
              <FormControl>
                <DobSelect value={field.value} onChange={field.onChange} />
              </FormControl>
              <FormDescription>
                Cần thiết theo luật COPPA (Mỹ) + GDPR Article 8 (EU). Không hiển thị public.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {showParentField && (
          <FormField
            control={form.control}
            name="parentEmail"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email cha mẹ / người giám hộ</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="off"
                    placeholder="parent@example.com"
                    {...field}
                  />
                </FormControl>
                <FormDescription className="flex items-start gap-1.5">
                  {/* Icon cảnh báo COPPA — dùng token semantic `warning` thay hex amber rời */}
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  <span>
                    Vì bạn dưới {COPPA_AGE_THRESHOLD} tuổi, Cogniva gửi link confirm
                    tới email này. Account sẽ limited (no AI, no upload) cho tới khi
                    cha mẹ verify.
                  </span>
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormDescription>At least 8 characters.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Create account
        </Button>
      </form>
    </Form>
  );
}
