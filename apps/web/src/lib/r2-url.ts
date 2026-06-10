/**
 * R2 URL helper — build public URL cho file đã upload lên R2 bucket.
 *
 * Khi LiveKit egress upload lên R2, field `fileResults[0].location` có thể
 * trả về URL internal `https://<account>.r2.cloudflarestorage.com/...` (không
 * play được public) HOẶC empty. Cần build URL public từ filename + env.
 *
 * 2 cách user setup R2 public access:
 *   1. `R2_PUBLIC_URL` env = `https://pub-xxx.r2.dev` (R2.dev subdomain, dev)
 *   2. `R2_PUBLIC_URL` env = `https://recordings.cogniva.app` (custom domain, prod)
 *
 * Nếu cả 2 chưa set → fallback trả internal URL (video player sẽ fail nhưng
 * pipeline transcript/summary vẫn chạy được, không cần file public).
 */

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

/**
 * Build URL khả dụng cho `<video src>` từ filename trả về bởi LiveKit egress.
 * filename dạng: `recordings/group/{channelId}/{ts}.mp4`
 */
export function buildR2PublicUrl(filename: string): string {
  if (!filename) return '';
  if (R2_PUBLIC_URL) {
    return `${R2_PUBLIC_URL.replace(/\/+$/, '')}/${filename.replace(/^\/+/, '')}`;
  }
  // Fallback: internal endpoint — chỉ download được nếu có credentials
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET_NAME ?? 'cogniva-recordings';
  if (!accountId) return filename;
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${filename}`;
}

/**
 * Resolve fileUrl từ LiveKit egress info:
 *   - Ưu tiên public URL build từ filename (chạy được trong `<video>`).
 *   - Fallback location nếu filename empty.
 *   - Trả null nếu cả 2 đều empty (egress fail thật sự).
 */
export function resolveEgressFileUrl(input: {
  filename?: string | null;
  location?: string | null;
}): string | null {
  if (input.filename) return buildR2PublicUrl(input.filename);
  if (input.location) return input.location;
  return null;
}
