/**
 * Form primitives — tích hợp react-hook-form với shadcn/ui.
 *
 * API tương đương shadcn template:
 *   <Form {...form}>
 *     <form onSubmit={form.handleSubmit(onSubmit)}>
 *       <FormField name="email" render={({ field }) => (
 *         <FormItem>
 *           <FormLabel>Email</FormLabel>
 *           <FormControl><Input {...field} /></FormControl>
 *           <FormDescription>Nhập email của bạn.</FormDescription>
 *           <FormMessage />   // tự render lỗi từ zod resolver
 *         </FormItem>
 *       )} />
 *     </form>
 *   </Form>
 *
 * Cách hoạt động bên trong:
 *  - FormField đặt context (tên field) cho các con bên dưới.
 *  - FormItem tạo id duy nhất qua React.useId() để liên kết label-input-message.
 *  - useFormField hook đọc 2 context để biết id + state lỗi của field hiện tại.
 *  - FormControl forward `aria-describedby` + `aria-invalid` cho a11y.
 */
'use client';

import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { Slot } from '@radix-ui/react-slot';
import { Controller, FormProvider, useFormContext, useFormState } from 'react-hook-form';
import type { ControllerProps, FieldPath, FieldValues } from 'react-hook-form';

import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

// Form re-export FormProvider để bọc react-hook-form context
const Form = FormProvider;

// ── Context lưu tên field hiện tại — FormItem con đọc để liên kết id ──
type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = { name: TName };

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);

/**
 * FormField — wrap Controller của react-hook-form, đồng thời cung cấp
 * context để các sub-component (Label, Message…) biết tên field.
 */
const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
};

/**
 * Hook nội bộ — trả về id, name + trạng thái lỗi của field hiện tại.
 * Dùng trong các sub-component (FormLabel, FormMessage, FormControl).
 */
const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: fieldContext.name });
  const fieldState = getFieldState(fieldContext.name, formState);

  if (!fieldContext) {
    throw new Error('useFormField should be used within <FormField>');
  }

  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
};

// ── Context cấp id duy nhất cho mỗi FormItem ───────────────────
type FormItemContextValue = { id: string };
const FormItemContext = React.createContext<FormItemContextValue>({} as FormItemContextValue);

/** Wrapper bọc 1 trường — cung cấp id cho label/control/message liên kết. */
const FormItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    // useId sinh id ổn định giữa SSR + client để tránh hydration mismatch
    const id = React.useId();
    return (
      <FormItemContext.Provider value={{ id }}>
        <div ref={ref} className={cn('space-y-2', className)} {...props} />
      </FormItemContext.Provider>
    );
  },
);
FormItem.displayName = 'FormItem';

/** Label tự gắn htmlFor đúng input + đổi màu khi có lỗi. */
const FormLabel = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => {
  const { error, formItemId } = useFormField();
  return (
    <Label
      ref={ref}
      className={cn(error && 'text-destructive', className)}
      htmlFor={formItemId}
      {...props}
    />
  );
});
FormLabel.displayName = 'FormLabel';

/**
 * Slot bọc input thật — gắn id, aria-describedby, aria-invalid.
 * Dùng asChild của Slot để các thuộc tính được forward xuống <Input/Select/...>
 * mà không phát sinh element thừa.
 */
const FormControl = React.forwardRef<
  React.ComponentRef<typeof Slot>,
  React.ComponentPropsWithoutRef<typeof Slot>
>(({ ...props }, ref) => {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();
  return (
    <Slot
      ref={ref}
      id={formItemId}
      aria-describedby={!error ? formDescriptionId : `${formDescriptionId} ${formMessageId}`}
      aria-invalid={!!error}
      {...props}
    />
  );
});
FormControl.displayName = 'FormControl';

/** Mô tả phụ dưới input — luôn hiện, dùng cho hint hoặc giải thích thêm. */
const FormDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => {
  const { formDescriptionId } = useFormField();
  return (
    <p
      ref={ref}
      id={formDescriptionId}
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
});
FormDescription.displayName = 'FormDescription';

/**
 * Hiện thông điệp lỗi từ zod resolver. Nếu có error → hiện `error.message`,
 * không có lỗi mà có children → hiện children (message custom). Cả 2 cùng
 * không có → return null (không render thẻ thừa).
 */
const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error.message) : children;
  if (!body) return null;
  return (
    <p
      ref={ref}
      id={formMessageId}
      className={cn('text-sm font-medium text-destructive', className)}
      {...props}
    >
      {body}
    </p>
  );
});
FormMessage.displayName = 'FormMessage';

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
};
