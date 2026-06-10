/**
 * concierge-faq — V5.2 (2026-05-22).
 *
 * Knowledge base FAQ cho AI Concierge — câu hỏi platform-level (KHÔNG về 1
 * tutor cụ thể) mà student / tutor thường hỏi. Planner match user query với
 * 1 trong các FAQ này → trả answer deterministic kèm relevant CTA.
 *
 * Lý do hardcode + không gọi LLM generate:
 *   1. Câu trả lời chính xác về policy Cogniva (refund, KYC, commission, ...)
 *      KHÔNG được phép hallucinate
 *   2. Deterministic + nhanh + free
 *   3. Update policy = edit file này, không cần retrain model
 *
 * Match strategy: keyword overlap + audience filter (student/tutor/both).
 */

export type FaqAudience = 'student' | 'tutor' | 'both';

export type FaqEntry = {
  id: string;
  /** Audience phù hợp — backend filter theo role planner detect. */
  audience: FaqAudience;
  /** Câu hỏi standard form (hiển thị trong bubble). */
  question: string;
  /** Answer markdown ngắn (< 200 từ). */
  answer: string;
  /** Keywords để match user query (lowercase, prefix-friendly). */
  keywords: string[];
  /** Suggested follow-up CTA — link hoặc reply. */
  cta?: { label: string; href: string };
};

export const FAQ_ENTRIES: FaqEntry[] = [
  // ─── Student-side FAQs ─────────────────────────────────────────────
  {
    id: 'trial-session',
    audience: 'student',
    question: 'Buổi học thử là gì? Có thật sự miễn phí không?',
    answer:
      'Buổi học thử kéo dài 30 phút, GIẢM 50% giá thường (KHÔNG hoàn toàn miễn phí — Cogniva yêu cầu thanh toán nhỏ để chống abuse). Mỗi học viên được dùng 1 buổi thử / gia sư. Sau buổi nếu không hợp, bạn không cần đặt tiếp.',
    keywords: ['trial', 'buổi thử', 'học thử', 'thử miễn phí', 'trial free', 'demo'],
    cta: { label: 'Tìm gia sư có buổi thử', href: '/tutoring?tab=tutors' },
  },
  {
    id: 'how-to-book',
    audience: 'student',
    question: 'Cách đặt buổi học đầu tiên?',
    answer:
      'Chọn tutor → bấm "Đặt buổi" → chọn ngày/giờ trong availability → confirm. Nếu tutor bật "Đặt ngay" (⚡), confirm tức thì. Nếu không, tutor có 24h để duyệt — nếu quá hạn, tự huỷ + hoàn ví.',
    keywords: ['đặt buổi', 'book', 'đặt lịch', 'how to book', 'đầu tiên', 'lần đầu'],
    cta: { label: 'Browse tutor', href: '/tutoring?tab=tutors' },
  },
  {
    id: 'refund-policy',
    audience: 'student',
    question: 'Huỷ buổi có được hoàn tiền không?',
    answer:
      'Huỷ trước 24h: hoàn 100% vào ví. Huỷ 6-24h: hoàn 50%. Huỷ < 6h hoặc no-show: không hoàn (tutor đã chuẩn bị). Tutor huỷ: bạn được hoàn 100% + 10% credit bonus cho lần sau.',
    keywords: [
      'huỷ',
      'huy',
      'hoàn tiền',
      'refund',
      'trả lại tiền',
      'cancel',
      'cancellation',
    ],
  },
  {
    id: 'payment-methods',
    audience: 'student',
    question: 'Cách thanh toán + nạp ví?',
    answer:
      'Cogniva dùng ví nội bộ (VND). Nạp ví qua: VNPay (ATM/QR), MoMo, chuyển khoản. Nạp ≥ 1 triệu được cashback 5% (90 ngày). Tiền trừ tự động khi book — không cần nhập thẻ mỗi lần.',
    keywords: ['thanh toán', 'nạp ví', 'pay', 'topup', 'vnpay', 'momo', 'chuyển khoản'],
    cta: { label: 'Mở ví', href: '/wallet' },
  },
  {
    id: 'pack-discount',
    audience: 'student',
    question: 'Mua pack có giảm bao nhiêu? So với buổi lẻ?',
    answer:
      'Pack 4 buổi: -10%. Pack 8 buổi: -15%. Pack 12+ buổi: -20%. Có thể trả góp 2-4 đợt (không lãi). Pack hết hạn sau 3 tháng kể từ ngày mua.',
    keywords: ['pack', 'gói', 'giảm giá', 'discount', 'combo', 'mua nhiều'],
    cta: { label: 'Xem pack có sẵn', href: '/tutoring?tab=tutors' },
  },
  {
    id: 'find-good-tutor',
    audience: 'student',
    question: 'Cách chọn gia sư tốt?',
    answer:
      'Check: (1) rating ≥ 4.5 + ≥ 10 review, (2) huy hiệu "✓ Verified" (đã xác minh CCCD), (3) phản hồi nhanh < 60p, (4) buổi đã dạy ≥ 50. Đọc 3-5 review mới nhất. Nếu không chắc, dùng "Buổi thử" trước khi cam kết.',
    keywords: ['chọn', 'tốt nhất', 'best', 'top', 'gia sư nào', 'recommend', 'gợi ý'],
    cta: { label: 'Top gia sư', href: '/tutoring?sort=top' },
  },
  {
    id: 'price-range',
    audience: 'student',
    question: 'Giá trung bình các môn?',
    answer:
      'Toán/Lý/Hoá THPT: 150-300k/h (trung vị ~200k). IELTS: 250-500k/h. TOEIC: 200-400k/h. Lập trình: 200-500k/h. Tiếng Anh giao tiếp: 150-400k/h. Tutor mới giá thấp hơn ~30%, tutor verified rating cao đắt hơn ~30%.',
    keywords: ['giá', 'price', 'bao nhiêu', 'trung bình', 'average', 'mức giá', 'phí'],
  },

  // ─── Tutor-side FAQs ───────────────────────────────────────────────
  {
    id: 'tutor-commission',
    audience: 'tutor',
    question: 'Hoa hồng platform là bao nhiêu?',
    answer:
      'Cogniva thu 15% / buổi đầu tiên với mỗi học viên mới (acquisition fee). Buổi 2-10 với học viên cũ: 10%. Từ buổi 11+: 5%. Cuối tuần / lễ tutor được trả thêm 10% bonus.',
    keywords: ['hoa hồng', 'commission', 'phí', 'platform fee', 'cogniva lấy bao nhiêu', '%'],
  },
  {
    id: 'tutor-payout',
    audience: 'tutor',
    question: 'Cách rút tiền + bao lâu nhận?',
    answer:
      'Yêu cầu payout từ "Ví" → "Rút tiền". Min 200k. Cogniva duyệt + chuyển khoản trong 2-3 ngày làm việc. Phí 5k/lệnh (Cogniva trả nếu rút ≥ 5 triệu).',
    keywords: ['rút tiền', 'payout', 'withdraw', 'nhận tiền', 'chuyển khoản'],
    cta: { label: 'Mở ví', href: '/wallet' },
  },
  {
    id: 'tutor-kyc',
    audience: 'tutor',
    question: 'KYC mất bao lâu duyệt?',
    answer:
      'Upload CCCD 2 mặt + selfie + bằng cấp. Admin duyệt trong 24-48h (24h ngày làm việc, 48h cuối tuần). Sau khi verified: huy hiệu ✓ Verified, tăng ~40% lead, được unlock instant-book.',
    keywords: ['kyc', 'xác minh', 'verify', 'cccd', 'bằng cấp', 'duyệt', 'verified'],
    cta: { label: 'Hoàn tất KYC', href: '/tutoring?tab=mine' },
  },
  {
    id: 'tutor-visibility',
    audience: 'tutor',
    question: 'Cách tăng visibility / nhận nhiều lead hơn?',
    answer:
      '1) Hoàn KYC ✓. 2) Bật "Đặt ngay" + "Buổi thử". 3) Phản hồi < 30 phút (ranking boost). 4) Headline cụ thể (môn + level + USP). 5) Bio nên có chi tiết: số năm, % học sinh đỗ, phương pháp. 6) Trả lời request tutor browse trong 1h đầu.',
    keywords: ['visibility', 'lead', 'tăng đơn', 'nhiều khách', 'ranking', 'top', 'thấy nhiều', 'tăng học sinh'],
  },
  {
    id: 'tutor-instant-book',
    audience: 'tutor',
    question: 'Đặt ngay (instant book) là gì?',
    answer:
      'Khi bật, học viên book → confirm tức thì, không cần bạn duyệt. Pros: tăng ~50% conversion. Cons: phải block hard các slot bận. Phù hợp cho tutor có lịch ổn định. Có thể tắt bất cứ lúc nào.',
    keywords: ['instant book', 'đặt ngay', 'auto confirm', 'tự duyệt'],
  },
  {
    id: 'tutor-cancel',
    audience: 'tutor',
    question: 'Tôi huỷ buổi có bị phạt không?',
    answer:
      'Huỷ trước 24h: không phạt. Huỷ < 24h: bị trừ 0.1 điểm rating + học viên được 10% credit. Huỷ ≥ 3 lần / tháng < 24h: mất ranking boost 2 tuần. Bệnh / emergency: gửi proof, admin xem xét.',
    keywords: ['huỷ buổi', 'cancel', 'phạt', 'penalty', 'không dạy được'],
  },

  // ─── Cross-audience (both) ─────────────────────────────────────────
  {
    id: 'support-contact',
    audience: 'both',
    question: 'Liên hệ support khi có vấn đề?',
    answer:
      'Email: hi@cogniva.vn (24h). Chat trực tiếp ở góc dưới phải app (giờ làm việc 8-22h). Vấn đề thanh toán: ưu tiên trong 2h. Tranh chấp huỷ/refund: admin xem xét trong 48h.',
    keywords: ['support', 'liên hệ', 'help', 'hỗ trợ', 'admin', 'báo cáo', 'khiếu nại'],
  },
  {
    id: 'how-platform-works',
    audience: 'both',
    question: 'Cogniva hoạt động thế nào?',
    answer:
      'Cogniva là marketplace gia sư có AI giúp match. Student gõ nhu cầu → AI Concierge gợi ý → đặt buổi qua ví → học → review. Tutor đăng profile → KYC → tìm request → apply / chờ student book → dạy → nhận thanh toán. Cogniva chỉ là cầu nối, không thuê dạy.',
    keywords: ['cogniva là gì', 'platform', 'hoạt động', 'how it works', 'cách dùng', 'mô hình'],
  },
];

/**
 * Match user query với FAQ entries.
 * Strategy: keyword overlap score + audience filter.
 *
 * @returns Best FAQ entry hoặc null nếu không có match đủ tốt
 */
export function matchFaq(
  query: string,
  audience: 'student' | 'tutor',
  threshold = 1,
): FaqEntry | null {
  const q = query.toLowerCase().normalize('NFC');
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);

  let best: { entry: FaqEntry; score: number } | null = null;

  for (const entry of FAQ_ENTRIES) {
    if (entry.audience !== 'both' && entry.audience !== audience) continue;

    let score = 0;
    for (const kw of entry.keywords) {
      const kwLower = kw.toLowerCase();
      // Full keyword match in query
      if (q.includes(kwLower)) {
        score += kwLower.length >= 5 ? 3 : 2;
        continue;
      }
      // Token overlap (less weight)
      for (const t of tokens) {
        if (kwLower.includes(t) || t.includes(kwLower)) {
          score += 1;
          break;
        }
      }
    }

    if (score >= threshold && (!best || score > best.score)) {
      best = { entry, score };
    }
  }

  return best ? best.entry : null;
}

/** Lấy danh sách FAQ áp dụng cho audience (UI hiển thị empty state suggestions). */
export function listFaqsForAudience(audience: 'student' | 'tutor'): FaqEntry[] {
  return FAQ_ENTRIES.filter(
    (e) => e.audience === 'both' || e.audience === audience,
  );
}
