/**
 * iCal — V4 T4 (2026-05-22). Port NGUYÊN VĂN từ apps/web/src/lib/tutoring/ical.ts
 * (web còn dùng bản gốc tới cutover — đổi format thì sửa CẢ HAI).
 *
 * Helper generate RFC 5545 .ics format từ booking + class data.
 * Dùng cho `/api/tutoring/ical/[token].ics` — public token-protected feed
 * Google/Outlook subscribe được.
 */
import { randomBytes } from 'node:crypto';

export type IcalEvent = {
  uid: string;
  summary: string;
  description?: string;
  startAt: Date;
  endAt: Date;
  location?: string;
  url?: string;
};

/** Generate random 32-char token (rotate quarterly admin). */
export function generateIcalToken(): string {
  return randomBytes(16).toString('hex');
}

/** Format Date → ICS DATETIME UTC (YYYYMMDDTHHMMSSZ). */
function fmtIcsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Escape special chars per RFC 5545. */
function escapeIcs(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** Build complete .ics feed string. */
export function buildIcsFeed(opts: {
  title: string;
  events: IcalEvent[];
}): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cogniva//Tutoring V4//VI',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(opts.title)}`,
    'X-WR-TIMEZONE:Asia/Ho_Chi_Minh',
  ];

  for (const ev of opts.events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.uid}@cogniva`);
    lines.push(`DTSTAMP:${fmtIcsDate(new Date())}`);
    lines.push(`DTSTART:${fmtIcsDate(ev.startAt)}`);
    lines.push(`DTEND:${fmtIcsDate(ev.endAt)}`);
    lines.push(`SUMMARY:${escapeIcs(ev.summary)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeIcs(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${escapeIcs(ev.location)}`);
    if (ev.url) lines.push(`URL:${ev.url}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  // RFC 5545: lines kết thúc CRLF
  return lines.join('\r\n');
}
