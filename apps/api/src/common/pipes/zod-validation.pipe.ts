/**
 * ZodValidationPipe — validate body bằng zod schema, lỗi trả ĐÚNG shape
 * `{ error: flatten() }` mà client web/mobile đang parse (contract §10 plan).
 * Dùng: `@Body(new ZodValidationPipe(schema)) dto: z.infer<typeof schema>`
 */
import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({ error: parsed.error.flatten() });
    }
    return parsed.data;
  }
}
