'use client';

import * as React from 'react';
import { Check, Loader2, Plus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, keepPreviousData } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { useT } from '@/lib/i18n/context';

type University = { id: string; name: string; shortName: string | null; docCount: number };
type Course = {
  id: string;
  name: string;
  code: string | null;
  universityId: string | null;
  docCount: number;
};

export function CoursePicker({
  onChange,
  initialCourse = null,
}: {
  onChange: (courseId: string | null) => void;
  initialCourse?: { id: string; label: string } | null;
}) {
  const t = useT();
  const [university, setUniversity] = React.useState<University | null>(null);
  const [course, setCourse] = React.useState<Course | null>(
    initialCourse
      ? {
          id: initialCourse.id,
          name: initialCourse.label,
          code: null,
          universityId: null,
          docCount: 0,
        }
      : null,
  );

  return (
    <div className="space-y-2.5">
      <div>
        <label className="text-muted-foreground mb-1 block text-[11px] font-medium">
          {t('library.picker.university_label')}
        </label>
        {university ? (
          <SelectedChip
            label={
              university.shortName
                ? `${university.name} (${university.shortName})`
                : university.name
            }
            onClear={() => {
              setUniversity(null);
              setCourse(null);
              onChange(null);
            }}
          />
        ) : (
          <UniversityCombobox
            onSelect={(u) => {
              setUniversity(u);
              setCourse(null);
              onChange(null);
            }}
          />
        )}
      </div>

      <div>
        <label className="text-muted-foreground mb-1 block text-[11px] font-medium">
          {t('library.picker.course_label')}
        </label>
        {course ? (
          <SelectedChip
            label={course.code ? `${course.code} — ${course.name}` : course.name}
            onClear={() => {
              setCourse(null);
              onChange(null);
            }}
          />
        ) : (
          <CourseCombobox
            universityId={university?.id ?? null}
            onSelect={(c) => {
              setCourse(c);
              onChange(c.id);
            }}
          />
        )}
      </div>
    </div>
  );
}

function SelectedChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <div className="border-discovery-500/40 bg-discovery-500/5 flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
      <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
        <Check className="text-discovery-600 h-3.5 w-3.5" />
        {label}
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label="Bỏ chọn"
        className="text-muted-foreground hover:text-foreground rounded p-0.5"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function UniversityCombobox({ onSelect }: { onSelect: (u: University) => void }) {
  const t = useT();
  const [q, setQ] = React.useState('');
  const [debouncedQ, setDebouncedQ] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const { data: results = [], isFetching: loading } = useQuery({
    queryKey: qk.libraryUniversities(debouncedQ),
    queryFn: () =>
      apiGet<{ universities: University[] }>(
        `/api/library/universities?q=${encodeURIComponent(debouncedQ)}`,
      ).then((d) => d.universities),
    placeholderData: keepPreviousData,
  });

  const create = async () => {
    if (q.trim().length < 2) return;
    setCreating(true);
    try {
      const data = await apiSend<{ university?: University; error?: string }>(
        '/api/library/universities',
        'POST',
        { name: q.trim() },
      );
      if (!data.university) {
        toast.error(data.error ?? t('library.picker.create_fail'));
        return;
      }
      toast.success(t('library.picker.suggested'));
      setQ('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const exactMatch = results.some((r) => r.name.toLowerCase() === q.trim().toLowerCase());

  return (
    <Combobox
      q={q}
      setQ={setQ}
      loading={loading}
      placeholder={t('library.picker.university_placeholder')}
      results={results.map((r) => ({
        id: r.id,
        primary: r.name,
        secondary: r.shortName ?? undefined,
        count: r.docCount,
        onClick: () => onSelect(r),
      }))}
      canCreate={q.trim().length >= 2 && !exactMatch}
      creating={creating}
      createLabel={`${t('library.picker.create_university')} "${q.trim()}"`}
      onCreate={create}
    />
  );
}

function CourseCombobox({
  universityId,
  onSelect,
}: {
  universityId: string | null;
  onSelect: (c: Course) => void;
}) {
  const t = useT();
  const [q, setQ] = React.useState('');
  const [debouncedQ, setDebouncedQ] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const { data: results = [], isFetching: loading } = useQuery({
    queryKey: qk.libraryCourses(debouncedQ, universityId),
    queryFn: () => {
      const sp = new URLSearchParams({ q: debouncedQ });
      if (universityId) sp.set('universityId', universityId);
      return apiGet<{ courses: Course[] }>(`/api/library/courses?${sp.toString()}`).then(
        (d) => d.courses,
      );
    },
    placeholderData: keepPreviousData,
  });

  const create = async () => {
    if (q.trim().length < 2) return;
    setCreating(true);
    try {
      const data = await apiSend<{ course?: Course; error?: string }>(
        '/api/library/courses',
        'POST',
        { name: q.trim(), ...(universityId ? { universityId } : {}) },
      );
      if (!data.course) {
        toast.error(data.error ?? t('library.picker.create_fail'));
        return;
      }
      toast.success(t('library.picker.suggested'));
      setQ('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const exactMatch = results.some((r) => r.name.toLowerCase() === q.trim().toLowerCase());

  return (
    <Combobox
      q={q}
      setQ={setQ}
      loading={loading}
      placeholder={t('library.picker.course_placeholder')}
      results={results.map((r) => ({
        id: r.id,
        primary: r.code ? `${r.code} — ${r.name}` : r.name,
        secondary: r.universityId ? undefined : t('library.picker.general'),
        count: r.docCount,
        onClick: () => onSelect(r),
      }))}
      canCreate={q.trim().length >= 2 && !exactMatch}
      creating={creating}
      createLabel={`${t('library.picker.create_course')} "${q.trim()}"`}
      onCreate={create}
    />
  );
}

type ComboItem = {
  id: string;
  primary: string;
  secondary?: string;
  count: number;
  onClick: () => void;
};

function Combobox({
  q,
  setQ,
  loading,
  placeholder,
  results,
  canCreate,
  creating,
  createLabel,
  onCreate,
}: {
  q: string;
  setQ: (v: string) => void;
  loading: boolean;
  placeholder: string;
  results: ComboItem[];
  canCreate: boolean;
  creating: boolean;
  createLabel: string;
  onCreate: () => void;
}) {
  const [focused, setFocused] = React.useState(false);
  const showDropdown = focused && (q.length > 0 || results.length > 0);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={placeholder}
          className="border-divider bg-background focus:border-discovery-500 w-full rounded-lg border py-2 pl-8 pr-8 text-[12.5px] focus:outline-none"
        />
        {loading && (
          <Loader2 className="text-muted-foreground absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin" />
        )}
      </div>

      {showDropdown && (
        <div className="border-divider bg-card shadow-elevated absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={r.onClick}
              className="hover:bg-muted flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] transition-colors"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{r.primary}</span>
                {r.secondary && (
                  <span className="text-muted-foreground text-[10.5px]">{r.secondary}</span>
                )}
              </span>
              {r.count > 0 && (
                <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
                  {r.count}
                </span>
              )}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onClick={onCreate}
              disabled={creating}
              className="border-divider text-discovery-600 hover:bg-discovery-500/5 flex w-full items-center gap-1.5 border-t px-3 py-2 text-left text-[12px] font-medium transition-colors"
            >
              {creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              {createLabel}
            </button>
          )}
          {results.length === 0 && !canCreate && (
            <p className="text-muted-foreground px-3 py-3 text-center text-[11.5px]">
              {q.length > 0 ? '...' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
