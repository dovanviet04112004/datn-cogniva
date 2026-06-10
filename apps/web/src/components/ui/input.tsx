/**
 * Input — wrap thẻ <input> với style shadcn/ui.
 *
 * Không dùng Radix vì <input> native đã đủ. forwardRef để react-hook-form
 * có thể truyền ref qua `register` mà không cần thêm logic.
 */
import * as React from 'react';

import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * Input — Cogniva design language:
 *   - rounded-xl (calm geometry)
 *   - bg-surface tách lớp khỏi background
 *   - shadow-soft inset feel, hover wash subtle
 *   - focus glow primary thay vì hard ring 2px (premium)
 *   - h-10 spacious (không cramped), placeholder muted layer
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full px-3.5 py-2 text-sm',
          'rounded-xl border border-input bg-surface',
          'shadow-soft transition-all duration-base ease-expo-out',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium',
          'placeholder:text-text-muted',
          'hover:border-border/80',
          'focus-visible:outline-none focus-visible:border-primary/40',
          'focus-visible:ring-4 focus-visible:ring-primary/15',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
