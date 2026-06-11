const FALLBACK = ['dovanviet04112004@gmail.com'];

export function isAdminEmailClient(email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = process.env.NEXT_PUBLIC_ADMIN_EMAILS;
  const list =
    raw && raw.length > 0
      ? raw
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : FALLBACK;
  return list.includes(email.toLowerCase());
}
