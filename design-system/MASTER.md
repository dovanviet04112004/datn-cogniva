# Cogniva — Design System (MASTER)

> **Nguồn chân lý (Source of Truth) cho UI của cả app — web + mobile.**
> Mọi màu / font / spacing / shadow / motion đều phải lấy từ **token** ở đây,
> KHÔNG hardcode hex rời rạc trong component.

**Tài liệu này = trích xuất + chuẩn hoá design system ĐANG CHẠY trong code.** Khi
code và tài liệu lệch nhau, ưu tiên token trong code rồi cập nhật lại file này.

**File token gốc (đọc kèm khi sửa):**

- Tokens (CSS vars, light + dark): [`apps/web/src/app/globals.css`](../apps/web/src/app/globals.css)
- Mapping Tailwind: [`apps/web/tailwind.config.ts`](../apps/web/tailwind.config.ts)
- Font load: [`apps/web/src/app/layout.tsx`](../apps/web/src/app/layout.tsx)
- Button: [`apps/web/src/components/ui/button.tsx`](../apps/web/src/components/ui/button.tsx)
- Dialog / Drawer: [`apps/web/src/components/ui/dialog.tsx`](../apps/web/src/components/ui/dialog.tsx) · [`drawer.tsx`](../apps/web/src/components/ui/drawer.tsx)
- Layout chuẩn page: [`apps/web/src/components/layout/page-shell.tsx`](../apps/web/src/components/layout/page-shell.tsx)

## Cách dùng (hierarchical retrieval)

```
design-system/
  MASTER.md          ← global rules (file này) — luôn áp dụng
  pages/<page>.md    ← override riêng cho 1 trang (nếu có)
```

1. Khi build / sửa 1 trang cụ thể → đọc `design-system/pages/<page>.md` trước.
2. File page tồn tại → rule trong đó **override** MASTER.
3. Không có file page → dùng MASTER 100%.

---

## 1. Bản sắc & nguyên tắc thiết kế

**Cogniva = "AI Learning OS"** — hệ điều hành học tập, không phải dashboard phẳng.

| Nguyên tắc                       | Diễn giải                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Calm spatial OS**              | Bề mặt phân lớp (layered surfaces) tạo chiều sâu bằng độ sáng, không bằng border thô. Ambient radial mesh rất nhạt trên `body`. |
| **Premium, Linear/Vercel-style** | Geist font, tracking siết nhẹ ở heading, shadow mềm, motion expo-out. Tối giản nhưng có "khối".                                 |
| **AI-accent indigo/violet**      | Primary indigo điện (`#6366f1`) là màu thương hiệu — dùng cho hành động chính, focus, điểm nhấn.                                |
| **Dark mode là first-class**     | Calm dark depths (`#0b1020` base, KHÔNG đen tuyền). Mọi token có cặp light + dark.                                              |
| **Token-first**                  | UI bind vào CSS var → đổi theme/độ bo/màu 1 chỗ, toàn app theo.                                                                 |

> ⚠️ Auto-recommendation của skill `ui-ux-pro-max` cho query "education" hay gợi
> Claymorphism + font kiểu trẻ con (Baloo/Comic Neue) + "avoid dark mode" — **KHÔNG
> áp dụng cho Cogniva**. Cogniva là công cụ học tập nghiêm túc: Geist + minimalism
> premium + dark mode core. Dùng skill cho checklist a11y/UX, KHÔNG cho màu/font.

---

## 2. Màu sắc (Color tokens)

Token khai báo dạng **HSL channels** (`H S L%`, không bọc `hsl()`) để Tailwind wrap
`hsl(var(--x))` → cho phép alpha modifier `bg-primary/50`. Hex chỉ để tham chiếu.

### 2.1 Core — Light

| Token                                  | HSL           | Hex       | Dùng cho                                   |
| -------------------------------------- | ------------- | --------- | ------------------------------------------ |
| `--background`                         | `220 40% 98%` | `#f6f8fc` | Nền app                                    |
| `--foreground`                         | `222 47% 11%` | `#0f172a` | Text chính                                 |
| `--surface`                            | `0 0% 100%`   | `#ffffff` | Card/panel lớp 1                           |
| `--surface-secondary`                  | `210 40% 98%` | `#f8fafc` | Vùng nền phụ                               |
| `--elevated`                           | `0 0% 100%`   | `#ffffff` | Popover/floating                           |
| `--card`                               | `0 0% 100%`   | `#ffffff` | Card                                       |
| `--popover`                            | `0 0% 100%`   | `#ffffff` | Popover                                    |
| `--primary`                            | `239 84% 67%` | `#6366f1` | **Hành động chính / brand**                |
| `--primary-hover`                      | `239 84% 57%` | `#4f46e5` | Hover/active primary                       |
| `--primary-foreground`                 | `0 0% 100%`   | `#ffffff` | Text trên primary                          |
| `--secondary` / `--muted` / `--accent` | `220 14% 96%` | `#f1f3f7` | Bề mặt phụ / wash                          |
| `--muted-foreground`                   | `215 25% 35%` | `#475569` | Text phụ (≥4.5:1)                          |
| `--text-muted`                         | `215 16% 65%` | `#94a3b8` | Metadata / timestamp                       |
| `--destructive`                        | `0 84% 60%`   | `#ef4444` | Lỗi / xoá                                  |
| `--success`                            | `142 71% 45%` | `#22c55e` | Thành công                                 |
| `--warning`                            | `38 92% 50%`  | `#f59e0b` | Cảnh báo                                   |
| `--border`                             | `220 13% 91%` | `#e5e7eb` | Viền                                       |
| `--divider`                            | `215 28% 95%` | `#eef2f7` | Line phân cách trong card (mềm hơn border) |
| `--input`                              | `220 13% 91%` | `#e5e7eb` | Viền input                                 |
| `--ring`                               | `239 84% 67%` | `#6366f1` | Focus ring                                 |

### 2.2 Core — Dark

| Token                  | HSL            | Hex        |
| ---------------------- | -------------- | ---------- |
| `--background`         | `228 49% 8%`   | `#0b1020`  |
| `--foreground`         | `220 56% 97%`  | `#f3f6fc`  |
| `--surface`            | `222 36% 11%`  | `#121826`  |
| `--surface-secondary`  | `220 36% 15%`  | `#182133`  |
| `--elevated`           | `224 34% 19%`  | `#1f2940`  |
| `--card`               | `220 36% 15%`  | `#182133`  |
| `--primary`            | `233 100% 74%` | `#7c8cff`  |
| `--primary-hover`      | `232 100% 80%` | `#98a6ff`  |
| `--primary-foreground` | `228 49% 8%`   | `#0b1020`  |
| `--muted-foreground`   | `215 20% 65%`  | `#94a3b8`  |
| `--text-muted`         | `215 19% 47%`  | `#64748b`  |
| `--border`             | `222 25% 22%`  | ~`#2a3344` |
| `--divider`            | `222 30% 14%`  | ~`#171e2b` |

> **Lưu ý dark:** `--primary-hover` SÁNG hơn `--primary` (light thì TỐI hơn). Đừng
> giả định hover luôn tối — luôn dùng token, đừng tự tính.

### 2.3 Surfaces ladder (thang chiều sâu)

`background → surface-secondary → surface → elevated → card`. Mỗi lớp +1–3% lightness.
Tạo depth bằng độ sáng, hạn chế border. Dùng `.bg-surface` / `.bg-elevated` (utility)
hoặc `bg-card`.

### 2.4 Semantic aliases (hex cố định, trong [`tailwind.config.ts`](../apps/web/tailwind.config.ts))

Grep `bg-voice-active` rõ ngữ cảnh hơn `bg-indigo-500`; đổi palette 1 chỗ.

| Class                 | Hex                          | Ý nghĩa                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voice-active`        | `#6366f1`                    | mic on / đang nói                                                                                                                                                                                                                                                                                                                               |
| `voice-mute`          | `#ef4444`                    | mic off / muted                                                                                                                                                                                                                                                                                                                                 |
| `stage-host`          | `#f43f5e`                    | host/OWNER trong stage                                                                                                                                                                                                                                                                                                                          |
| `forum`               | `#10b981`                    | forum channel accent                                                                                                                                                                                                                                                                                                                            |
| `recording-live`      | `#ef4444`                    | đang ghi/record live                                                                                                                                                                                                                                                                                                                            |
| `success`             | `#10b981`                    | positive                                                                                                                                                                                                                                                                                                                                        |
| `warning`             | `#f59e0b`                    | attention                                                                                                                                                                                                                                                                                                                                       |
| `discovery-{50..950}` | scale violet (`#8b5cf6`=500) | **Accent thứ 2** (Library / AI / discovery / PRO). Alias NGUYÊN scale violet để token-hoá (giữ đủ độ đậm nhạt, không flatten). Dùng `bg-discovery-500`, `text-discovery-600`, `border-discovery-500/30`, `dark:text-discovery-300`, gradient `from-discovery-600 to-fuchsia-600`… Đổi cả mảng library = sửa scale ở `tailwind.config.ts` 1 chỗ. |

### 2.5 Accent màu cho icon/metric (dùng Tailwind palette trực tiếp)

Dashboard stat dots & quick-action icon dùng tông Tailwind chuẩn: `blue-500` (tài liệu),
`emerald-500` (ôn tập/flashcard), `discovery-500` (AI/chat — alias scale violet, đã token-hoá
2026-06-03), `orange-500` (XP/streak). Giữ nhất quán: 1 domain = 1 màu xuyên suốt. Các domain
khác (blue/emerald/orange) hiện vẫn dùng Tailwind palette trực tiếp — có thể alias thành token
(`docs`/`cards`/`xp`) theo cùng pattern `discovery` nếu cần đồng bộ hoàn toàn.

---

## 3. Typography

**Font:** [Geist Sans](https://vercel.com/font) + Geist Mono, load qua `next/font` →
`var(--font-geist-sans)` / `var(--font-geist-mono)` (Tailwind `font-sans` / `font-mono`).

- `font-feature-settings: 'rlig' 1, 'calt' 1, 'cv11' 1, 'ss01' 1`
- Body letter-spacing `-0.011em`; heading (`h1–h4`) `-0.022em` (siết, Linear-style)
- Antialiased (`-webkit-font-smoothing: antialiased`)

### 3.1 Thang cỡ chữ

| Vai trò            | Class                                                          | Ghi chú                                    |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------ |
| Page title (H1)    | `text-2xl font-semibold` (PageShell)                           | Dashboard hero dùng `text-3xl sm:text-4xl` |
| Section title (H2) | `text-base`–`text-lg font-semibold tracking-tight`             |                                            |
| Card title (H3)    | `text-sm font-semibold tracking-tight`                         |                                            |
| Body               | `text-sm` (≥16px trên mobile — xem §11)                        | line-height 1.5–1.75 (`leading-relaxed`)   |
| Phụ / mô tả        | `text-xs text-muted-foreground`                                |                                            |
| **Eyebrow label**  | `text-[11px] font-semibold uppercase tracking-[0.12em–0.18em]` | nhãn nhỏ phía trên section/stat            |
| Metadata           | `text-[11px] text-text-muted`                                  |                                            |

> **Chuẩn hoá:** dùng `text-[11px]` cho eyebrow/metadata — TRÁNH cỡ lẻ lung tung
> (`text-[10.5px]`, `text-[10px]`) gây cảm giác "lạc quẻ". Tracking eyebrow: 0.12em
> (nhãn dày chữ) → 0.18em (nhãn brand như "AI LEARNING OS").

### 3.2 Số liệu / metric

Số đếm/metric to (XP, streak, count…) dùng **`tabular-nums` (sans Geist) + `font-bold`** —
**KHÔNG `font-mono`** (chữ số mono nhìn khô/cũ). `tabular-nums` vẫn canh cột thẳng. Vd:
`text-3xl font-bold tabular-nums leading-none tracking-tight`. Format theo locale:
`value.toLocaleString('vi-VN')`.

> `font-mono` chỉ giữ cho mã/ID/timestamp kỹ thuật (code, key invite…), KHÔNG cho metric.
> Thẻ metric dùng component chung **`StatCard`** (§9.5).

### 3.3 Quy tắc

- `line-length` ≤ 65–75 ký tự (`max-w-xl`/`max-w-prose` cho đoạn văn dài).
- `font-display: swap` (next/font lo sẵn) — không FOIT.
- Markdown render dùng plugin `@tailwindcss/typography` (`prose`).

---

## 4. Spacing, layout & radius

### 4.1 Container chuẩn — `PageShell`

Mọi trang trong `(app)/` bọc bằng [`PageShell`](../apps/web/src/components/layout/page-shell.tsx).
Đổi width/padding toàn app = sửa 1 file.

| `size`    | max-width    | Dùng cho                   |
| --------- | ------------ | -------------------------- |
| `narrow`  | `max-w-3xl`  | settings / form            |
| `default` | `max-w-5xl`  | trang thường               |
| `wide`    | `max-w-6xl`  | dashboard nhiều card       |
| `full`    | `max-w-none` | editor / canvas full-bleed |

Padding mặc định `p-6`; section spacing `space-y-6` (dashboard dùng `space-y-10`).

**Header: compact mặc định, hero opt-in.** `PageShell` render **header compact** (icon-tile
`h-8 w-8 bg-primary/10` + title `text-lg/xl` + description `text-[13px] line-clamp-1` + action,
hairline `border-b`) khi truyền `title`/`description`/`action`. Chỉ thêm prop `hero` cho **trang
landing/độ-quan-trọng cao** (hiện tại CHỈ dashboard) → khi đó dùng `PageHero` band gradient lớn.
KHÔNG dùng hero band cho mọi trang nội bộ — lặp 15 trang band khổng lồ làm app "nặng & cổ".
Eyebrow text chỉ hiển thị trong hero; header compact dùng `eyebrowIcon` (icon-tile) thay nhãn chữ.

### 4.2 Spacing scale

Theo thang Tailwind mặc định (4px step). Hay dùng: `gap-1.5 / gap-2 / gap-3 / gap-4`,
section `gap-y-5`, card padding `p-5`, dialog `p-3`–`p-4`.

### 4.3 Radius

`--radius: 0.625rem` (**10px**) → Tailwind: `rounded-lg`=10px, `rounded-md`=8px, `rounded-sm`=6px.

| Phần tử                         | Radius                      |
| ------------------------------- | --------------------------- |
| Button, card, quick-action      | `rounded-xl` (12px)         |
| Hero band, big panel            | `rounded-2xl` (16px)        |
| Input, dropdown item, badge nhỏ | `rounded-md` / `rounded-lg` |
| Pill / chip                     | `rounded-full`              |

---

## 5. Elevation (shadows)

CSS var-based → dark mode tự hạ opacity. Utility: `.shadow-soft / .shadow-elevated /
.shadow-glow / .shadow-primary` (và Tailwind `shadow-{soft,elevated,glow}`).

| Token               | Dùng cho                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `--shadow-soft`     | Card / panel nghỉ                                                                                        |
| `--shadow-elevated` | Hover card, floating panel                                                                               |
| `--shadow-glow`     | Hover nút primary (glow indigo)                                                                          |
| `--shadow-primary`  | **Nút primary trạng thái nghỉ** — inset sheen trên + drop mềm + glow nhạt → nút "nổi khối" thay vì phẳng |

> ⚠️ `.shadow-*` ghi thẳng `box-shadow`. Tailwind `ring-*` cũng ghi `box-shadow` →
> **không dùng `ring` chung với `.shadow-*` trên cùng element** (ghi đè nhau). Cần
> highlight viền trong cho nút có shadow → gộp vào 1 box-shadow (như `--shadow-primary`),
> đừng thêm `ring`.

---

## 6. Motion

| Token           | Giá trị                          | Tailwind        |
| --------------- | -------------------------------- | --------------- |
| `--motion-fast` | `150ms`                          | `duration-150`  |
| `--motion-base` | `220ms`                          | `duration-base` |
| `--motion-slow` | `380ms`                          | `duration-slow` |
| Easing premium  | `cubic-bezier(0.16, 1, 0.3, 1)`  | `ease-expo-out` |
| Easing soft     | `cubic-bezier(0.22, 1, 0.36, 1)` | `ease-soft-out` |

**Keyframes có sẵn:** `animate-fade-in` / `animate-fade-in-up` (entrance), `animate-soft-pulse`
(live dot), `animate-float-up` (reaction emoji), `accordion-down/up` (Radix).

**Quy tắc (skill UX):**

- Micro-interaction 150–300ms; transition màu/opacity/transform — KHÔNG transition `width/height`.
- Hover dùng color/shadow/translate nhẹ (`hover:-translate-y-0.5`), TRÁNH scale làm xô layout.
- Tối đa 1–2 element động mỗi view; animation vô hạn chỉ cho loader.
- **`prefers-reduced-motion`: bắt buộc tôn trọng.** Bọc hiệu ứng không thiết yếu.
- Entering `ease-out`, exiting `ease-in` — không `linear` cho UI.

---

## 7. Z-index scale

Dùng thang cố định, KHÔNG `z-[9999]`: **`z-10` (overlay nội bộ/ribbon) · `z-20` · `z-30`
· `z-40` (sidebar rail, mobile backdrop) · `z-50` (drawer/dialog/sidebar mobile)**. Nhớ:
element có `transform`/`opacity`/`filter` tạo stacking context mới → z-index con bị cô lập.

---

## 8. Icons

- Bộ icon **lucide-react** (đồng nhất, KHÔNG emoji làm icon).
- Cỡ: `h-4 w-4` (inline/button), `h-5 w-5` (card icon), `h-3–3.5` (badge/chip).
- `strokeWidth`: 1.75 (nghỉ) → 2–2.25 (active/nhấn mạnh).
- Icon-only button bắt buộc `aria-label`.

---

## 9. Component patterns

### 9.1 Button — [`button.tsx`](../apps/web/src/components/ui/button.tsx)

Base: `inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium
tracking-tight transition-all duration-base ease-expo-out` + `focus-visible:ring-2
focus-visible:ring-ring focus-visible:ring-offset-2` + `disabled:opacity-50`.

| Variant             | Style                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `default` (primary) | `bg-primary text-primary-foreground shadow-primary hover:bg-primary-hover hover:shadow-glow active:scale-[0.98]` |
| `destructive`       | `bg-destructive ... hover:bg-destructive/90`                                                                     |
| `outline`           | `border bg-surface/60 backdrop-blur-sm hover:bg-accent hover:border-foreground/15`                               |
| `secondary`         | `bg-secondary hover:bg-secondary/80`                                                                             |
| `ghost`             | `hover:bg-accent hover:text-accent-foreground`                                                                   |
| `link`              | `text-primary underline-offset-4 hover:underline`                                                                |

| Size      | Class                  |
| --------- | ---------------------- |
| `sm`      | `h-9 px-3 text-[13px]` |
| `default` | `h-10 px-4 py-2`       |
| `lg`      | `h-11 px-8`            |
| `icon`    | `h-10 w-10`            |

**Quy tắc:** cần variant mới → thêm vào `buttonVariants` (cva), KHÔNG inline class rời
(theo guideline shadcn). Nút async → disable khi đang chạy + show spinner.

### 9.2 Card / surface

`rounded-xl border border-divider bg-card shadow-soft`; hover (nếu clickable):
`hover:-translate-y-0.5 hover:shadow-elevated hover:border-foreground/15` + `cursor-pointer`.

### 9.3 Dialog & Drawer — [`dialog.tsx`](../apps/web/src/components/ui/dialog.tsx) · [`drawer.tsx`](../apps/web/src/components/ui/drawer.tsx)

- Overlay: `bg-foreground/30` (dialog) / `bg-black/40` (drawer). **KHÔNG `backdrop-blur`**
  trên overlay — quyết định thiết kế: làm mờ nền dưới gây rối, đã gỡ toàn bộ modal.
- Content: `rounded-2xl bg-background shadow-xl`; drawer slide từ phải (`max-w-md`, full-height).
- Đóng = nút `X` `aria-label="Đóng"`; chặn đóng khi đang thao tác bất đồng bộ (vd upload).
- **KHÔNG dùng `confirm()/prompt()/alert()` native** → dùng `useConfirm/usePrompt` + toast.

### 9.4 QuickAction card (dashboard)

Card hành động: icon gradient bg + title + description + arrow. **CTA phải vào hành động
THẬT** (mở dialog / deep-link id cụ thể), không đổ ra trang trống. Trạng thái `urgent`:
`border-primary/40 ring-2 ring-primary/15` + ribbon `bg-primary` (tông brand, hợp mọi
accent). Dùng urgent để làm nổi 1 CTA ưu tiên, KHÔNG nhân bản nút.

### 9.5 SectionHeading + StatCard (component CHUNG — bắt buộc dùng)

Hai primitive này thay các bản copy hardcode per-page. **Tiêu đề mục + thẻ metric mới
phải import từ đây**, KHÔNG tự code lại trong từng trang.

- **`SectionHeading`** — [`components/ui/section-heading.tsx`](../apps/web/src/components/ui/section-heading.tsx):
  `<SectionHeading count={n} action={…}>Nhãn</SectionHeading>`. Style: title đậm `text-sm
font-semibold` + count chip + hairline kéo hết hàng. Thay style cũ "— LABEL" gạch tí hon
  (`h-px w-6 from-primary/60 to-transparent` + uppercase tracking).
- **`StatCard`** — [`components/ui/stat-card.tsx`](../apps/web/src/components/ui/stat-card.tsx):
  `<StatCard icon={…} accent="from-blue-500/25 to-blue-500/5" tintText="text-blue-600
dark:text-blue-400" label="…" value={n.toLocaleString('vi-VN')} hint="…" />`. Look premium
  (đồng ngôn ngữ với QuickAction): **badge icon gradient** `h-10 rounded-xl` + quầng accent
  - **sheen line** trên + **thanh accent đáy** grow-on-hover + số **sans tabular-nums đậm**
    (không mono) + hover lift. Prop `accent` (gradient `from-X/25 to-X/5`) cho tông giàu; nếu chỉ
    truyền `tint` (vd 'bg-blue-500/10') thì badge phẳng (tương thích call cũ). 1 domain = 1 màu
    (blue=docs, emerald=cards, discovery=AI, orange=XP/streak — §2.5).
- **Cụm KPI đếm (overview)** → KHÔNG xếp grid ô vuông rời. Dùng **`DashboardStatsBand`**
  ([`components/dashboard/stats-band.tsx`](../apps/web/src/components/dashboard/stats-band.tsx)):
  1 card liền, các mục chia bằng `divide-x` (desktop) / `divide-y` (mobile xếp dọc), mỗi mục =
  icon màu + số `tabular-nums` + nhãn + ngữ cảnh + thanh accent đáy. Pattern Linear/Vercel —
  premium, hết cảm giác "ô vuông". `StatCard` (lẻ) giữ cho metric đứng riêng / khác loại nhau.

### 9.6 Sidebar — [`sidebar.tsx`](../apps/web/src/components/app/sidebar.tsx)

Rail Discord-style: desktop `w-14` icon-only, hover expand `w-64` overlay; mobile drawer.
Active: accent bar trái `bg-primary` + icon `text-primary`. Tone riêng (`--sidebar-*`).
Section group có thể collapse (persist localStorage). **Dashboard KHÔNG lặp lại nav của
sidebar** — sidebar đã là nơi điều hướng.

### 9.7 Badge / pill / chip

`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium`

- tông theo ngữ cảnh (`border-primary/20 bg-primary/5 text-primary`, hoặc orange cho streak…).

### 9.8 Form

Dùng `react-hook-form` + shadcn `Form`/`FormField` (validation chuẩn), KHÔNG tự xử lý
`<form onSubmit>`. Input có `<label htmlFor>`. Lỗi hiện gần field, rõ ràng.

### 9.9 Toast — Sonner

`<Toaster richColors closeButton />` mount 1 lần ở root. Dùng `toast.success/error/...`.

### 9.10 EmptyState — [`components/ui/empty-state.tsx`](../apps/web/src/components/ui/empty-state.tsx)

Khối "chưa có gì" dùng `<EmptyState icon={LucideIcon} title description? action? compact?/>`.
Style: card `bg-surface-secondary/50 border-divider rounded-2xl` (**KHÔNG border-dashed** — viền
đứt nét trông như wireframe chưa xong) + icon-tile gradient `from-primary/15 to-discovery-500/10`

- title `text-sm font-semibold` + description `text-[13px] muted` + action. `compact` (py-10) cho
  khối trong panel hẹp, mặc định py-16. **Mọi empty state phải dùng component này**, KHÔNG tự code
  `border-dashed` rời. (Bản cũ ở `components/layout/empty-state.tsx` đã xoá 2026-06-13.)
  > Phân biệt: dropzone upload (react-dropzone), notice phân quyền, slot trống lịch — KHÔNG phải
  > empty state, giữ style riêng của chúng.

---

## 10. Accessibility & chất lượng

| Hạng mục         | Yêu cầu                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Contrast**     | Text thường ≥ 4.5:1. Text phụ tối thiểu `muted-foreground` (`#475569` light) — KHÔNG dùng gray-400/lighter cho body.      |
| **Focus**        | Mọi element tương tác có focus ring nhìn thấy (`focus-visible:ring-2 ring-ring`). KHÔNG `outline-none` mà không thay thế. |
| **Touch target** | ≥ 44×44px trên mobile.                                                                                                    |
| **Keyboard**     | Tab order khớp thứ tự nhìn; dùng click/tap cho tương tác chính (không chỉ hover).                                         |
| **Icon-only**    | `aria-label`. Ảnh có nghĩa → `alt`.                                                                                       |
| **Màu**          | Không dùng MÀU là chỉ báo duy nhất (kèm icon/label).                                                                      |
| **Motion**       | Tôn trọng `prefers-reduced-motion`.                                                                                       |
| **Loading**      | Thao tác > 300ms → skeleton/spinner; reserve chỗ tránh content jumping.                                                   |

### Pre-delivery checklist (chạy trước khi giao UI)

- [ ] Không emoji làm icon (dùng lucide SVG)
- [ ] Icon cùng bộ, cùng cỡ; `strokeWidth` nhất quán
- [ ] Mọi element click có `cursor-pointer` + hover feedback
- [ ] Transition 150–300ms; hover không xô layout
- [ ] Focus state nhìn thấy cho keyboard
- [ ] Light + dark mode đều đủ contrast; border nhìn thấy cả 2 mode
- [ ] Responsive 375 / 768 / 1024 / 1440px; không scroll ngang trên mobile
- [ ] Dùng token (`bg-primary`) — KHÔNG hex rời / `var()` thừa
- [ ] `prefers-reduced-motion` được tôn trọng

---

## 11. Web + Mobile parity (Expo / React Native)

`apps/mobile` (Expo RN) chia sẻ **data layer** (types/API/query/validation) ở
`packages/shared` (RN-safe). UI thì mỗi app riêng, NHƯNG **phải dùng cùng design language**
ở MASTER này. RN không có CSS var/Tailwind core → mirror token bằng giá trị đã resolve:

| Token             | Light     | Dark       |
| ----------------- | --------- | ---------- |
| primary           | `#6366f1` | `#7c8cff`  |
| primary-hover     | `#4f46e5` | `#98a6ff`  |
| background        | `#f6f8fc` | `#0b1020`  |
| surface / card    | `#ffffff` | `#182133`  |
| elevated          | `#ffffff` | `#1f2940`  |
| foreground (text) | `#0f172a` | `#f3f6fc`  |
| muted-foreground  | `#475569` | `#94a3b8`  |
| border            | `#e5e7eb` | `~#2a3344` |
| destructive       | `#ef4444` | `#ef4444`  |
| success           | `#22c55e` | `#22c55e`  |
| warning           | `#f59e0b` | `#f59e0b`  |

**Quy ước mobile:**

- Cùng primary indigo, cùng thang type, cùng radius (10–16), cùng motion (220ms expo-out).
- Geist nếu nhúng được; nếu không → system sans gần nhất + Geist Mono cho số liệu.
- Touch target ≥ 44px (vốn dễ đạt hơn web).
- Dùng NativeWind (nếu có) để tái dùng class, hoặc 1 file `tokens.ts` resolve từ bảng trên.

---

## 12. Provenance

- Tạo từ skill `ui-ux-pro-max` (test) + **trích xuất token thật** trong code (2026-06-03).
- Skill khuyến nghị màu/font generic (Claymorphism/Baloo) → **bỏ qua**, giữ hệ Geist/indigo
  hiện có. Skill dùng cho: khung tài liệu + checklist a11y/UX + guideline shadcn/RN.
- Khi đổi token: sửa `globals.css` + `tailwind.config.ts` TRƯỚC, rồi cập nhật file này.
- Liên quan kỉ luật kiến trúc: xem memory `feedback_conform_arch_standards`,
  `feedback_web_mobile_shared_discipline`, `feedback_functional_quick_actions`.
