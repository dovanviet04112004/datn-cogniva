/**
 * @cogniva/shared — exports tổng hợp cho consumer (web + mobile).
 *
 * Tránh re-export `@cogniva/db` ở đây vì DB package có dependency native
 * (postgres-js, drizzle-kit) → KHÔNG bundle vào React Native Metro được.
 *
 * Types/schemas ở đây phải PLAIN TS, không native deps, không Node-only API.
 */
export * from './api';
export * from './types';
export * from './schemas';
