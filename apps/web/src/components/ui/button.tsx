/**
 * Button — primitive theo chuẩn shadcn/ui (New York).
 *
 * Hỗ trợ:
 *  - 6 variant: default | destructive | outline | secondary | ghost | link
 *  - 4 size: default | sm | lg | icon (vuông cho nút chỉ có icon)
 *  - asChild: render thành phần con (Slot của Radix) thay vì <button> —
 *    dùng khi cần biến Link, Anchor, … thành nút có style giống Button
 *    mà không lồng button-trong-button.
 *
 * Khi cần biến thể mới: thêm vào `buttonVariants` cva, đừng tạo file riêng.
 */
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// cva = class-variance-authority — gom các class theo variant + size để
// đảm bảo conflict được twMerge xử lý đúng và type được suy luận tự động.
//
// Cogniva design language:
//   - rounded-xl default (calm geometry, không sharp)
//   - duration-base ease-expo-out cho hover smooth
//   - Primary: subtle gradient accent → hover lift glow
//   - Secondary: translucent surface với border subtle
//   - Ghost: pure transparency với hover wash
//   - Destructive: low-saturation red (không gắt)
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded-xl text-sm font-medium tracking-tight',
    'ring-offset-background transition-all duration-base ease-expo-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        // Primary — inset sheen + accent shadow (shadow-primary), hover lift glow.
        // shadow-primary đã gộp highlight + drop trong 1 box-shadow nên KHÔNG dùng
        // kèm Tailwind `ring` ở đây (ring cũng ghi box-shadow → sẽ ghi đè nhau).
        default: [
          'bg-primary text-primary-foreground',
          'shadow-primary hover:bg-primary-hover hover:shadow-glow',
          'active:scale-[0.98]',
        ].join(' '),
        // Destructive — low saturation red, không gắt
        destructive: [
          'bg-destructive text-destructive-foreground',
          'shadow-soft hover:bg-destructive/90',
          'active:scale-[0.98]',
        ].join(' '),
        // Outline — translucent surface với border, subtle hover wash
        outline: [
          'border border-border bg-surface/60 backdrop-blur-sm',
          'hover:bg-accent hover:border-foreground/15 hover:text-accent-foreground',
        ].join(' '),
        // Secondary — surface tone, hover slightly elevated
        secondary: [
          'bg-secondary text-secondary-foreground',
          'hover:bg-secondary/80',
        ].join(' '),
        // Ghost — pure transparency, hover wash
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        // Link — primary-tinted text với underline animate
        link: 'text-primary underline-offset-4 hover:underline hover:text-primary-hover',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3 text-[13px]',
        lg: 'h-11 px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Nếu true, render thành <Slot> để stylesheet apply lên child. */
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
