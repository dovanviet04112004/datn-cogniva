/**
 * BKT (Bayesian Knowledge Tracing) — shim re-export.
 *
 * Logic THUẦN đã chuyển sang `@cogniva/shared/domain` để mobile dùng chung
 * (xem packages/shared/src/domain/bkt.ts). File này giữ lại như lớp mỏng để các
 * importer cũ (`@/lib/mastery/bkt`) không phải đổi đường dẫn.
 */
export { INITIAL_SCORE, updateMastery, decay } from '@cogniva/shared/domain';
