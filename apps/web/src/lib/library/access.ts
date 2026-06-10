/**
 * Library access gate (Phase 4 Step 5, 2026-05-27).
 *
 * Tập trung logic "user có quyền xem/import/download doc này không" để:
 *   - File proxy route + download route + import route dùng chung
 *   - Detail page server-side fetch xác định state hiển thị "Mua" hay "Mở"
 *
 * Quy tắc PRO:
 *   PRO user → free access mọi premium doc + free preview. Mua doc vẫn ghi
 *   purchase row (free, price=0) để track analytics? — V1 đơn giản skip
 *   purchase row, gate chỉ check plan + ownership + purchase.
 */
import { and, eq } from 'drizzle-orm';

import { db, libraryDoc, libraryDocPurchase, user as userTable } from '@cogniva/db';

export type AccessResult =
  | { allowed: true; reason: 'free' | 'owner' | 'pro' | 'purchased' }
  | { allowed: false; reason: 'not_found' | 'unauthenticated' | 'premium_unpurchased' };

export type DocAccessInfo = {
  doc: {
    id: string;
    uploaderId: string;
    isPremium: boolean;
    priceVnd: number | null;
    status: string;
  };
  access: AccessResult;
  /** PRO active = user.plan='PRO' && (proUntilAt > now hoặc proUntilAt=NULL legacy). */
  isProActive: boolean;
};

/**
 * Check access cho 1 doc cụ thể. userId=null cho anonymous viewer.
 *
 * Anonymous được phép xem preview free doc (status=PUBLISHED, isPremium=false)
 * nhưng KHÔNG được xem premium doc.
 */
export async function checkDocAccess(
  docId: string,
  userId: string | null,
): Promise<DocAccessInfo | null> {
  const [doc] = await db
    .select({
      id: libraryDoc.id,
      uploaderId: libraryDoc.uploaderId,
      isPremium: libraryDoc.isPremium,
      priceVnd: libraryDoc.priceVnd,
      status: libraryDoc.status,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, docId))
    .limit(1);
  if (!doc) return null;

  // Free doc → ai cũng xem được (nhưng cần PUBLISHED). Preview demo PROCESSING
  // không cấp truy cập trừ owner.
  if (!doc.isPremium) {
    if (doc.status === 'PUBLISHED') {
      return {
        doc,
        access: { allowed: true, reason: 'free' },
        isProActive: false,
      };
    }
    // Doc draft/processing → chỉ owner xem
    if (userId && userId === doc.uploaderId) {
      return {
        doc,
        access: { allowed: true, reason: 'owner' },
        isProActive: false,
      };
    }
    return {
      doc,
      access: { allowed: false, reason: 'premium_unpurchased' },
      isProActive: false,
    };
  }

  // Premium doc — cần auth
  if (!userId) {
    return {
      doc,
      access: { allowed: false, reason: 'unauthenticated' },
      isProActive: false,
    };
  }

  // Owner luôn pass
  if (userId === doc.uploaderId) {
    return {
      doc,
      access: { allowed: true, reason: 'owner' },
      isProActive: false,
    };
  }

  // Check PRO + purchase parallel
  const [proRow] = await db
    .select({ plan: userTable.plan, proUntilAt: userTable.proUntilAt })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  const isProActive =
    proRow?.plan === 'PRO' &&
    (proRow.proUntilAt === null || proRow.proUntilAt > new Date());

  if (isProActive) {
    return { doc, access: { allowed: true, reason: 'pro' }, isProActive: true };
  }

  const [purchase] = await db
    .select({ id: libraryDocPurchase.id })
    .from(libraryDocPurchase)
    .where(
      and(
        eq(libraryDocPurchase.docId, docId),
        eq(libraryDocPurchase.buyerId, userId),
      ),
    )
    .limit(1);

  if (purchase) {
    return {
      doc,
      access: { allowed: true, reason: 'purchased' },
      isProActive: false,
    };
  }

  return {
    doc,
    access: { allowed: false, reason: 'premium_unpurchased' },
    isProActive: false,
  };
}

/**
 * Lightweight PRO active check — chỉ user.plan + proUntilAt, không touch libraryDoc.
 * Dùng cho rate-limit free vs PRO.
 */
export async function isUserPro(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ plan: userTable.plan, proUntilAt: userTable.proUntilAt })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  if (!row) return false;
  if (row.plan !== 'PRO') return false;
  if (row.proUntilAt && row.proUntilAt < new Date()) return false;
  return true;
}
