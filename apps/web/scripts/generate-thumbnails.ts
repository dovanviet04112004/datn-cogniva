import { and, eq, isNull, or } from 'drizzle-orm';
import sharp from 'sharp';

import { db, libraryDoc } from '@cogniva/db';
import { SUBJECT_BY_SLUG } from '@cogniva/db/taxonomy';

import { putR2Object, getPublicUrl } from './r2-client';

const REGENERATE = process.argv.includes('--regenerate');

const SUBJECT_COLORS: Record<string, { from: string; to: string; accent: string }> = {
  math: { from: '#3b82f6', to: '#1e40af', accent: '#dbeafe' },
  physics: { from: '#8b5cf6', to: '#6d28d9', accent: '#ede9fe' },
  chemistry: { from: '#10b981', to: '#047857', accent: '#d1fae5' },
  biology: { from: '#84cc16', to: '#4d7c0f', accent: '#ecfccb' },
  literature: { from: '#f59e0b', to: '#b45309', accent: '#fef3c7' },
  english: { from: '#06b6d4', to: '#0e7490', accent: '#cffafe' },
  'english-ielts': { from: '#0ea5e9', to: '#0369a1', accent: '#e0f2fe' },
  'english-toeic': { from: '#0284c7', to: '#075985', accent: '#bae6fd' },
  japanese: { from: '#ef4444', to: '#b91c1c', accent: '#fee2e2' },
  'cs-programming': { from: '#a855f7', to: '#7e22ce', accent: '#f3e8ff' },
  history: { from: '#a16207', to: '#713f12', accent: '#fef3c7' },
  geography: { from: '#0d9488', to: '#115e59', accent: '#ccfbf1' },
  default: { from: '#6366f1', to: '#4338ca', accent: '#e0e7ff' },
};

const DOC_TYPE_LABEL: Record<string, string> = {
  lecture_notes: 'Bài giảng',
  summary: 'Đề cương',
  exam: 'Đề thi',
  exercise: 'Bài tập',
  solution: 'Lời giải',
  reference_book: 'Sách tham khảo',
  thesis: 'Luận văn',
  handout: 'Slide',
  mind_map: 'Sơ đồ',
  other: 'Tài liệu',
};

const DOC_TYPE_ICON: Record<string, string> = {
  lecture_notes: '📚',
  summary: '📝',
  exam: '📋',
  exercise: '✏️',
  solution: '💡',
  reference_book: '📖',
  thesis: '🎓',
  handout: '📊',
  mind_map: '🗺️',
  other: '📄',
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapTextSvg(text: string, maxChars = 22): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).length > maxChars && current) {
      lines.push(current);
      current = w;
    } else {
      current = current ? `${current} ${w}` : w;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 5);
}

function buildSvg({
  title,
  subjectEmoji,
  subjectName,
  docTypeLabel,
  docTypeIcon,
  level,
  pageCount,
  color,
}: {
  title: string;
  subjectEmoji: string;
  subjectName: string;
  docTypeLabel: string;
  docTypeIcon: string;
  level: string;
  pageCount: number | null;
  color: { from: string; to: string; accent: string };
}): string {
  const W = 600;
  const H = 800;
  const titleLines = wrapTextSvg(escapeXml(title), 20);
  const titleStartY = 320 - titleLines.length * 22;

  return `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${color.from}" />
      <stop offset="100%" stop-color="${color.to}" />
    </linearGradient>
    <linearGradient id="overlay" x1="0%" y1="50%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="black" stop-opacity="0" />
      <stop offset="100%" stop-color="black" stop-opacity="0.4" />
    </linearGradient>
  </defs>

  <!-- Background gradient -->
  <rect width="${W}" height="${H}" fill="url(#bg)" />

  <!-- Decorative dots pattern -->
  <g opacity="0.08" fill="white">
    <circle cx="80" cy="120" r="4" />
    <circle cx="200" cy="80" r="3" />
    <circle cx="340" cy="160" r="5" />
    <circle cx="500" cy="100" r="3" />
    <circle cx="120" cy="220" r="3" />
    <circle cx="460" cy="240" r="4" />
    <circle cx="550" cy="320" r="3" />
  </g>

  <!-- Large doc type icon -->
  <text x="${W / 2}" y="220" text-anchor="middle" font-size="120" opacity="0.18">
    ${docTypeIcon}
  </text>

  <!-- Subject badge top -->
  <g transform="translate(40, 50)">
    <rect width="180" height="36" rx="18" fill="white" opacity="0.18" />
    <text x="20" y="24" font-family="sans-serif" font-size="16" fill="white" font-weight="600">
      ${subjectEmoji}  ${escapeXml(subjectName.slice(0, 12))}
    </text>
  </g>

  <!-- Level badge top-right -->
  <g transform="translate(${W - 130}, 50)">
    <rect width="90" height="36" rx="18" fill="white" opacity="0.18" />
    <text x="45" y="24" font-family="sans-serif" font-size="14" fill="white" font-weight="600" text-anchor="middle">
      ${escapeXml(level)}
    </text>
  </g>

  <!-- Title (wrapped) -->
  <g font-family="sans-serif" fill="white" font-weight="800">
    ${titleLines
      .map(
        (line, i) =>
          `<text x="${W / 2}" y="${titleStartY + i * 44}" font-size="32" text-anchor="middle">${line}</text>`,
      )
      .join('')}
  </g>

  <!-- Doc type label center -->
  <g transform="translate(${W / 2}, 540)">
    <rect x="-90" y="-22" width="180" height="40" rx="20" fill="${color.accent}" />
    <text x="0" y="5" font-family="sans-serif" font-size="14" fill="${color.to}" font-weight="700" text-anchor="middle">
      ${docTypeIcon}  ${escapeXml(docTypeLabel.toUpperCase())}
    </text>
  </g>

  <!-- Bottom overlay + watermark -->
  <rect x="0" y="${H - 200}" width="${W}" height="200" fill="url(#overlay)" />
  ${
    pageCount
      ? `<text x="40" y="${H - 60}" font-family="sans-serif" font-size="13" fill="white" opacity="0.8" font-weight="600">${pageCount} TRANG</text>`
      : ''
  }
  <text x="${W - 40}" y="${H - 60}" text-anchor="end" font-family="sans-serif" font-size="11" fill="white" opacity="0.7" letter-spacing="2px">COGNIVA LIBRARY</text>
</svg>`.trim();
}

async function main() {
  const filter = REGENERATE
    ? eq(libraryDoc.status, 'PUBLISHED')
    : and(eq(libraryDoc.status, 'PUBLISHED'), or(isNull(libraryDoc.previewThumbUrl)));

  const docs = await db
    .select({
      id: libraryDoc.id,
      uploaderId: libraryDoc.uploaderId,
      title: libraryDoc.title,
      subjectSlug: libraryDoc.subjectSlug,
      docType: libraryDoc.docType,
      level: libraryDoc.level,
      pageCount: libraryDoc.pageCount,
    })
    .from(libraryDoc)
    .where(filter);

  if (docs.length === 0) {
    console.log('Không có doc cần generate thumbnail. Dùng --regenerate để chạy hết.');
    return;
  }

  console.log(`🎨 Generate thumbnails cho ${docs.length} doc...\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]!;
    const idx = `[${i + 1}/${docs.length}]`;
    console.log(`${idx} ${doc.title.slice(0, 50)}${doc.title.length > 50 ? '…' : ''}`);

    try {
      const subj = SUBJECT_BY_SLUG[doc.subjectSlug];
      const color = SUBJECT_COLORS[doc.subjectSlug] ?? SUBJECT_COLORS.default!;
      const level =
        {
          PRIMARY: 'Tiểu học',
          SECONDARY: 'THCS',
          HIGH_SCHOOL: 'THPT',
          UNIVERSITY: 'ĐH',
          ADULT: 'Người lớn',
        }[doc.level as string] ?? doc.level;

      const svg = buildSvg({
        title: doc.title,
        subjectEmoji: subj?.emoji ?? '📚',
        subjectName: subj?.name ?? doc.subjectSlug,
        docTypeLabel: DOC_TYPE_LABEL[doc.docType] ?? 'Tài liệu',
        docTypeIcon: DOC_TYPE_ICON[doc.docType] ?? '📄',
        level,
        pageCount: doc.pageCount,
        color,
      });

      const jpegBuffer = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();

      const storageKey = `lib/${doc.uploaderId}/${doc.id}-thumb.jpg`;
      await putR2Object(storageKey, jpegBuffer, 'image/jpeg');
      const publicUrl = getPublicUrl(storageKey);

      await db
        .update(libraryDoc)
        .set({ previewThumbUrl: publicUrl, updatedAt: new Date() })
        .where(eq(libraryDoc.id, doc.id));

      console.log(
        `       ✓ ${(jpegBuffer.length / 1024).toFixed(1)} KB → ${publicUrl.slice(0, 60)}...`,
      );
      success++;
    } catch (err) {
      console.log(`       ✗ ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\n────────────────────────────────`);
  console.log(`Success: ${success}/${docs.length}`);
  console.log(`Failed: ${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
