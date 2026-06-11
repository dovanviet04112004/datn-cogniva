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
  isProActive: boolean;
};

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

  if (!doc.isPremium) {
    if (doc.status === 'PUBLISHED') {
      return {
        doc,
        access: { allowed: true, reason: 'free' },
        isProActive: false,
      };
    }
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

  if (!userId) {
    return {
      doc,
      access: { allowed: false, reason: 'unauthenticated' },
      isProActive: false,
    };
  }

  if (userId === doc.uploaderId) {
    return {
      doc,
      access: { allowed: true, reason: 'owner' },
      isProActive: false,
    };
  }

  const [proRow] = await db
    .select({ plan: userTable.plan, proUntilAt: userTable.proUntilAt })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  const isProActive =
    proRow?.plan === 'PRO' && (proRow.proUntilAt === null || proRow.proUntilAt > new Date());

  if (isProActive) {
    return { doc, access: { allowed: true, reason: 'pro' }, isProActive: true };
  }

  const [purchase] = await db
    .select({ id: libraryDocPurchase.id })
    .from(libraryDocPurchase)
    .where(and(eq(libraryDocPurchase.docId, docId), eq(libraryDocPurchase.buyerId, userId)))
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
