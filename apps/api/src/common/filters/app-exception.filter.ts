/**
 * Exception filter toàn cục — GIỮ NGUYÊN error shape client đang phụ thuộc:
 * `{ error: string | object }` (web + mobile parse field `error`, gồm cả
 * zod flatten()). KHÔNG đổi shape trong suốt migration (contract §10 plan).
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      // HttpException có thể mang body tuỳ ý — nếu đã đúng shape {error} thì
      // giữ nguyên, nếu là string/shape Nest mặc định thì gói lại.
      if (typeof body === 'object' && body !== null && 'error' in body && !('statusCode' in body)) {
        res.status(status).json(body);
        return;
      }
      const message =
        typeof body === 'string'
          ? body
          : ((body as Record<string, unknown>).message ?? exception.message);
      res.status(status).json({ error: message });
      return;
    }

    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ error: 'Internal server error' });
  }
}
