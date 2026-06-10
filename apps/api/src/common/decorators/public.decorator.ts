import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Đánh dấu route bỏ qua AuthGuard (health, webhooks, auth endpoints…). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
