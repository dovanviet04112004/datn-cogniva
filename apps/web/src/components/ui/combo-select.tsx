/**
 * ComboSelect — dropdown gõ-để-lọc cho danh sách CỐ ĐỊNH (thay <select> cứng).
 *
 * Khác CoursePicker (search async + tạo mới): đây cho list có sẵn (môn taxonomy,
 * cấp học, loại tài liệu, hình thức dạy...). Gõ → lọc bỏ dấu tiếng Việt → chọn.
 * Controlled: value/onChange. Dùng ở form upload tài liệu + form gia sư.
 */
'use client';

import * as React from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

import { cn } from '@/lib/utils';

export type ComboOption = { value: string; label: string; hint?: string };

/** Bỏ dấu + thường hoá để lọc kiểu "giai tich" khớp "Giải tích". */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function ComboSelect({
  value,
  onChange,
  options,
  placeholder = 'Chọn…',
  className,
  disabled,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** id cho input → để `<Label htmlFor>` liên kết được (a11y). */
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // id ổn định cho ARIA combobox (input ↔ listbox ↔ option active-descendant).
  const reactId = React.useId();
  const inputId = id ?? `${reactId}-input`;
  const listboxId = `${reactId}-listbox`;
  const optionId = (i: number) => `${reactId}-opt-${i}`;

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = React.useMemo(() => {
    const nq = normalize(q);
    if (!nq) return options;
    return options.filter((o) =>
      normalize(`${o.label} ${o.value} ${o.hint ?? ''}`).includes(nq),
    );
  }, [q, options]);

  // Đóng dropdown khi click ra ngoài.
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQ('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQ('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // không submit form
      if (open && filtered[active]) pick(filtered[active]!.value);
      else setOpen(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQ('');
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {/* Trông như ô search (icon kính lúp) thay vì dropdown — gõ để chọn. */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          id={inputId}
          // ARIA combobox: input điều khiển listbox, báo trạng thái mở + option đang active.
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open && filtered[active] ? optionId(active) : undefined}
          value={open ? q : selected?.label ?? ''}
          placeholder={selected ? selected.label : placeholder}
          disabled={disabled}
          readOnly={!open}
          onFocus={() => {
            if (!disabled) {
              setOpen(true);
              setActive(0);
            }
          }}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            'w-full rounded-lg border border-input bg-background py-2 pl-9 pr-9 text-sm outline-none transition-colors focus:border-primary/60',
            open ? 'cursor-text' : 'cursor-pointer',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        />
        {/* Chevron phải → tín hiệu "đây là dropdown" (ngoài kính lúp gõ-lọc bên trái). */}
        <ChevronDown
          className={cn(
            'pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </div>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-divider bg-card shadow-elevated"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-center text-[12px] text-muted-foreground">
              Không có kết quả
            </p>
          ) : (
            filtered.map((o, i) => (
              <button
                key={o.value}
                type="button"
                id={optionId(i)}
                role="option"
                aria-selected={o.value === value}
                onMouseDown={(e) => {
                  e.preventDefault(); // giữ focus, tránh blur trước onClick
                  pick(o.value);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors',
                  i === active ? 'bg-muted' : 'hover:bg-muted',
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{o.label}</span>
                  {o.hint && (
                    <span className="text-[10.5px] text-muted-foreground">{o.hint}</span>
                  )}
                </span>
                {o.value === value && (
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
