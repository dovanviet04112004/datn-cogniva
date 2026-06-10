/**
 * LibraryAccessService — gate "user có quyền xem/import/download doc này không",
 * port từ apps/web/src/lib/library/access.ts (Phase 4 Step 5).
 *
 * Quy tắc PRO: PRO active → free access mọi premium doc; mua doc vẫn ghi
 * purchase row (route purchase lo) — gate chỉ check plan + ownership + purchase.
 */
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infra/database/prisma.service';

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

@Injectable()
export class LibraryAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check access cho 1 doc cụ thể. userId=null cho anonymous viewer.
   * Anonymous được xem preview free doc PUBLISHED, KHÔNG được xem premium.
   */
  async checkDocAccess(docId: string, userId: string | null): Promise<DocAccessInfo | null> {
    const row = await this.prisma.library_doc.findUnique({
      where: { id: docId },
      select: {
        id: true,
        uploader_id: true,
        is_premium: true,
        price_vnd: true,
        status: true,
      },
    });
    if (!row) return null;

    const doc = {
      id: row.id,
      uploaderId: row.uploader_id,
      isPremium: row.is_premium ?? false,
      priceVnd: row.price_vnd,
      status: row.status ?? 'PROCESSING',
    };

    // Free doc → ai cũng xem được (cần PUBLISHED). Draft/processing → chỉ owner.
    if (!doc.isPremium) {
      if (doc.status === 'PUBLISHED') {
        return { doc, access: { allowed: true, reason: 'free' }, isProActive: false };
      }
      if (userId && userId === doc.uploaderId) {
        return { doc, access: { allowed: true, reason: 'owner' }, isProActive: false };
      }
      return {
        doc,
        access: { allowed: false, reason: 'premium_unpurchased' },
        isProActive: false,
      };
    }

    // Premium doc — cần auth
    if (!userId) {
      return { doc, access: { allowed: false, reason: 'unauthenticated' }, isProActive: false };
    }

    // Owner luôn pass
    if (userId === doc.uploaderId) {
      return { doc, access: { allowed: true, reason: 'owner' }, isProActive: false };
    }

    const proRow = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, pro_until_at: true },
    });
    const isProActive =
      proRow?.plan === 'PRO' &&
      (proRow.pro_until_at === null || proRow.pro_until_at > new Date());

    if (isProActive) {
      return { doc, access: { allowed: true, reason: 'pro' }, isProActive: true };
    }

    const purchase = await this.prisma.library_doc_purchase.findFirst({
      where: { doc_id: docId, buyer_id: userId },
      select: { id: true },
    });
    if (purchase) {
      return { doc, access: { allowed: true, reason: 'purchased' }, isProActive: false };
    }

    return {
      doc,
      access: { allowed: false, reason: 'premium_unpurchased' },
      isProActive: false,
    };
  }

  /** Lightweight PRO active check — chỉ user.plan + proUntilAt (rate-limit free vs PRO). */
  async isUserPro(userId: string): Promise<boolean> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, pro_until_at: true },
    });
    if (!row) return false;
    if (row.plan !== 'PRO') return false;
    if (row.pro_until_at && row.pro_until_at < new Date()) return false;
    return true;
  }
}
