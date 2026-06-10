/**
 * Client-side admin guard — render conditional UI.
 *
 * KHÔNG dùng cho authorization (server vẫn check qua isAdminEmail). Mục
 * đích chỉ là ẩn link admin trong sidebar cho user thường.
 *
 * Env: NEXT_PUBLIC_ADMIN_EMAILS comma-separated. Fallback owner email.
 */

const FALLBACK = ['dovanviet04112004@gmail.com'];

export function isAdminEmailClient(email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = process.env.NEXT_PUBLIC_ADMIN_EMAILS;
  const list = raw && raw.length > 0
    ? raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : FALLBACK;
  return list.includes(email.toLowerCase());
}
