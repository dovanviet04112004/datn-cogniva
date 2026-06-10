/**
 * UploadWizard — V1 Library upload form.
 *
 * Single-page form, không phải multi-step modal (đơn giản hơn cho MVP).
 * Validate client-side, presign URL → PUT R2 → finalize.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FileText, Loader2, Upload as UploadIcon, X } from 'lucide-react';
import { toast } from 'sonner';

import { apiSend, ApiRequestError } from '@cogniva/shared/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ComboSelect } from '@/components/ui/combo-select';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';

import { CoursePicker } from './course-picker';

const MAX_BYTES = 20 * 1024 * 1024;

// Label dịch qua t() tại render (labelKey thay cho string cứng).
const DOC_TYPES = [
  { value: 'lecture_notes', labelKey: 'library.upload.doctype.lecture_notes' },
  { value: 'summary', labelKey: 'library.upload.doctype.summary' },
  { value: 'exam', labelKey: 'library.upload.doctype.exam' },
  { value: 'exercise', labelKey: 'library.upload.doctype.exercise' },
  { value: 'solution', labelKey: 'library.upload.doctype.solution' },
  { value: 'reference_book', labelKey: 'library.upload.doctype.reference_book' },
  { value: 'thesis', labelKey: 'library.upload.doctype.thesis' },
  { value: 'handout', labelKey: 'library.upload.doctype.handout' },
  { value: 'mind_map', labelKey: 'library.upload.doctype.mind_map' },
  { value: 'other', labelKey: 'library.upload.doctype.other' },
];

const LEVELS = [
  { value: 'PRIMARY', labelKey: 'library.upload.level.primary' },
  { value: 'SECONDARY', labelKey: 'library.upload.level.secondary' },
  { value: 'HIGH_SCHOOL', labelKey: 'library.upload.level.high_school' },
  { value: 'UNIVERSITY', labelKey: 'library.upload.level.university' },
  { value: 'ADULT', labelKey: 'library.upload.level.adult' },
];

export function UploadWizard({
  initialCourse = null,
}: {
  initialCourse?: { id: string; label: string } | null;
}) {
  const t = useT();
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  const [progress, setProgress] = React.useState<
    'idle' | 'hashing' | 'init' | 'uploading' | 'finalizing' | 'done'
  >('idle');
  const [submitting, setSubmitting] = React.useState(false);

  // Form fields
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  // University→Course model: courseId là phân loại chính (subject suy từ course server-side).
  const [courseId, setCourseId] = React.useState<string | null>(initialCourse?.id ?? null);
  const [level, setLevel] = React.useState('HIGH_SCHOOL');
  const [grade, setGrade] = React.useState<string>('');
  const [docType, setDocType] = React.useState('summary');
  const [schoolYear, setSchoolYear] = React.useState('');
  const [tags, setTags] = React.useState('');
  const [license, setLicense] = React.useState<'CC-BY-4.0' | 'PUBLIC_DOMAIN' | 'MINE_ONLY'>('CC-BY-4.0');
  const [licenseConfirmed, setLicenseConfirmed] = React.useState(false);

  const fileFormat = React.useMemo<'pdf' | 'docx' | 'image' | null>(() => {
    if (!file) return null;
    if (file.type === 'application/pdf') return 'pdf';
    if (
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.name.endsWith('.docx')
    )
      return 'docx';
    if (file.type.startsWith('image/')) return 'image';
    return null;
  }, [file]);

  const handleFileChange = (f: File | null) => {
    if (f && f.size > MAX_BYTES) {
      toast.error(t('library.upload.err_too_large'));
      return;
    }
    setFile(f);
    // Auto-fill title từ filename nếu chưa có
    if (f && !title) {
      setTitle(f.name.replace(/\.[^.]+$/, ''));
    }
  };

  // B3.18: drag-drop state — dragActive bật khi user kéo file vào drop-zone.
  // Wire drop event để accept file mà không phải click input.
  const [dragActive, setDragActive] = React.useState(false);
  const onDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragActive) setDragActive(true);
  };
  const onDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Chỉ reset khi user leave thật (relatedTarget ngoài drop-zone)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragActive(false);
  };
  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileChange(f);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !fileFormat) {
      toast.error(t('library.upload.err_choose_file'));
      return;
    }
    if (!licenseConfirmed) {
      toast.error(t('library.upload.err_license'));
      return;
    }
    if (title.trim().length < 5) {
      toast.error(t('library.upload.err_title'));
      return;
    }

    setSubmitting(true);
    try {
      // 1. Compute SHA-256 hash client-side
      setProgress('hashing');
      const buf = await file.arrayBuffer();
      const hashBuf = await crypto.subtle.digest('SHA-256', buf);
      const hash = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      // 2. Init upload — get presigned URL. 409 = trùng hash (đã upload) → báo riêng.
      setProgress('init');
      let init: { docId: string; storageKey: string; presignedUrl: string };
      try {
        init = await apiSend<{
          docId: string;
          storageKey: string;
          presignedUrl: string;
        }>('/api/library/docs/upload-init', 'POST', {
          filename: file.name,
          contentType: file.type || (fileFormat === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
          sizeBytes: file.size,
          hash,
          format: fileFormat,
        });
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 409) {
          toast.error(err.message || t('library.upload.err_already'));
          setProgress('idle');
          setSubmitting(false);
          return;
        }
        throw err; // lỗi khác → outer catch
      }

      // 3. PUT file lên R2
      setProgress('uploading');
      const putRes = await fetch(init.presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putRes.ok) throw new Error(t('library.upload.err_r2'));

      // 4. Finalize → trigger ingest
      setProgress('finalizing');
      await apiSend('/api/library/docs/finalize', 'POST', {
        docId: init.docId,
        storageKey: init.storageKey,
        title: title.trim(),
        description: description.trim() || undefined,
        courseId: courseId ?? undefined,
        level,
        grade: grade ? parseInt(grade, 10) : undefined,
        docType,
        schoolYear: schoolYear || undefined,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 10),
        license,
        licenseConfirmed: true,
      });

      setProgress('done');
      toast.success(t('library.upload.success'));
      router.push(`/library/${init.docId}`);
    } catch (err) {
      toast.error((err as Error).message);
      setProgress('idle');
    } finally {
      setSubmitting(false);
    }
  };

  const progressLabel: Record<typeof progress, string> = {
    idle: t('library.upload.progress.idle'),
    hashing: t('library.upload.progress.hashing'),
    init: t('library.upload.progress.init'),
    uploading: t('library.upload.progress.uploading'),
    finalizing: t('library.upload.progress.finalizing'),
    done: t('library.upload.progress.done'),
  };

  // B2.9: % progress cho mỗi stage để render bar trực quan.
  const progressPercent: Record<typeof progress, number> = {
    idle: 0,
    hashing: 10,
    init: 25,
    uploading: 60,
    finalizing: 90,
    done: 100,
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {/* File picker */}
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('library.upload.step1')}
        </p>
        <label
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={cn(
            'flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 transition-all',
            file
              ? 'border-emerald-500/40 bg-emerald-500/5'
              : dragActive
                ? 'scale-[1.01] border-discovery-500 bg-discovery-500/10 shadow-md'
                : 'border-divider hover:border-discovery-500/40 hover:bg-discovery-500/5',
          )}
        >
          <input
            type="file"
            accept=".pdf,.docx,image/*"
            className="hidden"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <>
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <p className="text-sm font-semibold">{file.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {fileFormat?.toUpperCase()} · {(file.size / 1024 / 1024).toFixed(2)}MB
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setFile(null);
                }}
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-rose-500 hover:underline"
              >
                <X className="h-3 w-3" />
                {t('library.upload.changed_file')}
              </button>
            </>
          ) : (
            <>
              <UploadIcon
                className={cn(
                  'h-10 w-10 transition-colors',
                  dragActive ? 'text-discovery-600' : 'text-muted-foreground',
                )}
              />
              <p className="text-sm font-semibold">
                {dragActive ? t('library.upload.drop_here') : t('library.upload.drag_here')}
              </p>
              <p className="text-[11.5px] text-muted-foreground">
                {t('library.upload.or')}{' '}
                <span className="font-semibold text-discovery-600 underline">
                  {t('library.upload.click_to_choose')}
                </span>
              </p>
              <p className="mt-1 text-[10.5px] text-muted-foreground/70">
                {t('library.upload.formats')}
              </p>
            </>
          )}
        </label>
      </section>

      {/* Metadata */}
      <section className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('library.upload.step2')}
        </p>
        <Input
          placeholder={t('library.upload.title_placeholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
        <Textarea
          placeholder={t('library.upload.desc_placeholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={2000}
        />

        {/* University→Course picker — phân loại chính (thay subject taxonomy) */}
        <div className="rounded-xl border border-divider bg-muted/20 p-3">
          <CoursePicker onChange={setCourseId} initialCourse={initialCourse} />
        </div>

        {/* Lĩnh vực đã bỏ — server tự suy từ khoá học đã chọn ở trên (course.subjectArea). */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">
              {t('library.upload.level')}
            </label>
            <ComboSelect
              value={level}
              onChange={setLevel}
              placeholder={t('library.upload.level')}
              options={LEVELS.map((l) => ({ value: l.value, label: t(l.labelKey) }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">
              {t('library.upload.doctype_label')}
            </label>
            <ComboSelect
              value={docType}
              onChange={setDocType}
              placeholder={t('library.upload.doctype_label')}
              options={DOC_TYPES.map((dt) => ({ value: dt.value, label: t(dt.labelKey) }))}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">
              {t('library.upload.grade')}
            </label>
            <Input
              type="number"
              min={1}
              max={12}
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              placeholder={t('library.upload.grade_placeholder')}
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">
              {t('library.upload.school_year')}
            </label>
            <Input
              placeholder={t('library.upload.school_year_placeholder')}
              value={schoolYear}
              onChange={(e) => setSchoolYear(e.target.value)}
              pattern="\d{4}-\d{4}"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">
            {t('library.upload.tags')}
          </label>
          <Input
            placeholder={t('library.upload.tags_placeholder')}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </div>
      </section>

      {/* License */}
      <section className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
          {t('library.upload.step3')}
        </p>
        <div className="flex flex-col gap-1.5">
          {(['CC-BY-4.0', 'PUBLIC_DOMAIN', 'MINE_ONLY'] as const).map((l) => (
            <label key={l} className="flex cursor-pointer items-center gap-2 text-[12.5px]">
              <input
                type="radio"
                checked={license === l}
                onChange={() => setLicense(l)}
              />
              <span>
                {l === 'CC-BY-4.0' && t('library.upload.license.cc')}
                {l === 'PUBLIC_DOMAIN' && t('library.upload.license.public')}
                {l === 'MINE_ONLY' && t('library.upload.license.mine')}
              </span>
            </label>
          ))}
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-[12.5px] font-medium text-amber-800 dark:text-amber-200">
          <input
            type="checkbox"
            checked={licenseConfirmed}
            onChange={(e) => setLicenseConfirmed(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            {t('library.upload.license_confirm')}
          </span>
        </label>
      </section>

      {/* B2.9: Upload progress bar — visualize % thay cho text + spinner */}
      {progress !== 'idle' && (
        <section className="space-y-1.5">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground/90">
              <Loader2 className="h-3 w-3 animate-spin text-discovery-600" />
              {progressLabel[progress]}
            </span>
            <span className="font-mono font-semibold tabular-nums text-discovery-600">
              {progressPercent[progress]}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-discovery-500 to-fuchsia-500 transition-all duration-500 ease-out"
              style={{ width: `${progressPercent[progress]}%` }}
              role="progressbar"
              aria-valuenow={progressPercent[progress]}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={progressLabel[progress]}
            />
          </div>
        </section>
      )}

      {/* Submit */}
      <div className="flex items-center justify-end gap-3">
        <Button type="submit" disabled={!file || !licenseConfirmed || submitting}>
          {submitting ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <UploadIcon className="mr-1 h-3.5 w-3.5" />
          )}
          {t('library.upload.progress.idle')}
        </Button>
      </div>
    </form>
  );
}
