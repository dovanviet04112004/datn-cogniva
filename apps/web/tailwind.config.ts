/**
 * Cấu hình Tailwind CSS cho apps/web.
 *
 * Thiết kế theo chuẩn shadcn/ui (New York style):
 *  - Sử dụng CSS variables (HSL) thay vì màu cứng → đổi theme runtime dễ
 *    bằng cách switch class "dark" trên <html>.
 *  - Color tokens (background, primary, muted, …) đều bind tới biến
 *    --background, --primary, … khai báo trong src/app/globals.css.
 *  - Bổ sung token riêng cho Cogniva: nhóm `sidebar.*` để theme sidebar
 *    độc lập với main content.
 *  - darkMode: 'class' để next-themes có thể toggle qua DOM thay vì
 *    media query của OS (cho phép user override).
 */
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      // Geist là font chính thức của Vercel — load qua next/font ở layout.tsx
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
      // Colors bind vào CSS variables để hỗ trợ light/dark theme
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        // Layered surface tokens — depth hierarchy
        // background → surface → surface-secondary → elevated → card
        surface: {
          DEFAULT: 'hsl(var(--surface))',
          secondary: 'hsl(var(--surface-secondary))',
        },
        elevated: 'hsl(var(--elevated))',
        // Divider — subtler than border, dùng cho line phân cách
        // bên trong card/panel (tránh border-on-border)
        divider: 'hsl(var(--divider))',
        // Text muted — layer 3 sau foreground và muted-foreground.
        // Dùng cho timestamp, label phụ, metadata phụ.
        'text-muted': 'hsl(var(--text-muted))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          hover: 'hsl(var(--primary-hover))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Token riêng của Cogniva — sidebar dùng tone tách biệt với background
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
        /*
         * Semantic alias — gom các màu hardcode lặp đi lặp lại thành 1 ý nghĩa.
         * Grep `bg-voice-active` rõ ngữ cảnh hơn `bg-indigo-500`; đổi palette
         * một chỗ.
         *
         * Quy ước:
         *   - voice-active : mic on / đang nói (indigo)
         *   - voice-mute   : mic off / muted (red)
         *   - stage-host   : host / OWNER trong stage channel (rose)
         *   - forum        : forum channel accent (emerald)
         *   - recording-live: đang ghi/record live (red)
         *   - success      : success/positive (emerald)
         *   - warning      : warning/attention (amber)
         */
        'voice-active': {
          DEFAULT: '#6366f1', // indigo-500
          foreground: '#ffffff',
        },
        'voice-mute': {
          DEFAULT: '#ef4444', // red-500
          foreground: '#ffffff',
        },
        'stage-host': {
          DEFAULT: '#f43f5e', // rose-500
          foreground: '#ffffff',
        },
        forum: {
          DEFAULT: '#10b981', // emerald-500
          foreground: '#ffffff',
        },
        'recording-live': {
          DEFAULT: '#ef4444', // red-500
          foreground: '#ffffff',
        },
        success: {
          DEFAULT: '#10b981', // emerald-500
          foreground: '#ffffff',
        },
        warning: {
          DEFAULT: '#f59e0b', // amber-500
          foreground: '#ffffff',
        },
        /*
         * Discovery — accent VIOLET thứ 2 của brand (Library / AI / discovery /
         * PRO). Trước đây dùng `violet-*` rải rác ~60 chỗ. Alias NGUYÊN SCALE
         * violet (50–950) để token-hoá: dùng `discovery-500/600/...` thay
         * `violet-*` → đổi palette domain này 1 chỗ. Domain accent (§2.5) cần đủ
         * scale nên alias scale thay vì 1 CSS-var đơn (giữ độ đậm nhạt, không
         * flatten). Hex = đúng thang violet của Tailwind → trông y hệt.
         */
        discovery: {
          DEFAULT: '#8b5cf6', // violet-500
          foreground: '#ffffff',
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
          950: '#2e1065',
        },
      },
      // Border radius scale theo --radius — đổi 1 biến là toàn UI bo theo
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      // Motion duration tokens — premium fluid feel.
      // Default Tailwind: 150ms (fast). Cogniva thêm base/slow cho panel
      // transition / morph effect cảm giác "fluid OS".
      transitionDuration: {
        base: 'var(--motion-base)',
        slow: 'var(--motion-slow)',
      },
      // Custom easing — cubic-bezier "expo-out" cho cảm giác premium
      // (slow-out, fast-in tail) — dùng cho hover lift, panel expand.
      transitionTimingFunction: {
        'expo-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'soft-out': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      // Box-shadow tokens — replace Tailwind default với CSS var-based
      // để dark mode tự apply opacity thấp hơn.
      boxShadow: {
        soft: 'var(--shadow-soft)',
        elevated: 'var(--shadow-elevated)',
        glow: 'var(--shadow-glow)',
      },
      // Animations: accordion (Radix) + fade-in cho hero/marketing
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
      },
    },
  },
  // tailwindcss-animate: cung cấp các class animate-* cho Radix primitives
  // @tailwindcss/typography: class `prose` cho rendering markdown đẹp
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
};

export default config;
