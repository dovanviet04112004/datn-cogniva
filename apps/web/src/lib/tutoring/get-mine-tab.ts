/**
 * getMineTab — dữ liệu cho tab "Tổng quan" (?tab=mine) của /tutoring (server-only).
 *
 * Vì sao tách khỏi component + cache:
 *   `MineTab` (mine-tab.tsx) trước inline 4 query (profile + my requests + upcoming
 *   bookings + my applications) chạy mỗi lần render. 4 query này read thuần, đổi
 *   chậm (chỉ khi user book/huỷ/đổi lịch/apply/đăng yêu cầu) → cache-aside Redis
 *   (TTL 120s) cắt round-trip DB cho lần ghé lại trong cửa sổ ngắn.
 *
 * Invalidation thật (không chỉ dựa TTL): mọi route đổi trạng thái booking/request/
 *   application của user gọi `onTutoringMineChanged(affectedUserId)` → xoá key này.
 *   Cả 2 phía (student + tutor) của 1 booking đều được xoá vì booking hiện ở MineTab
 *   của cả hai (upcomingBookings union student-side + tutor-side).
 *
 * dbReplica: 4 read thuần (select/join/count), không read-your-own-write tức thì
 *   trong cùng request → route sang replica giảm tải primary (fallback primary).
 *
 * Date-serialization: data đi qua cache Redis (JSON) → Date thành string. Consumer
 *   `mine-tab.tsx` gọi `a.createdAt.toISOString()` trên application → CẦN Date thật.
 *   Vì vậy re-hydrate các field Date sau cache để giữ type honest (tránh type-lie).
 */
import { and, asc, desc, eq, gte, or } from 'drizzle-orm';

import {
  dbReplica,
  tutorApplication,
  tutorProfile,
  tutorRequest,
  tutoringBooking,
  user as userTable,
} from '@cogniva/db';

import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

/** Profile gia sư của chính user (toàn bộ cột — preview + edit link). */
type MineProfile = typeof tutorProfile.$inferSelect;

/** 1 dòng "Yêu cầu của tôi" (subset cột student đã đăng). */
type MineRequest = {
  id: string;
  title: string;
  subjectSlug: string;
  level: string;
  modality: string;
  urgency: string;
  status: string;
  budgetVnd: number | null;
  createdAt: Date;
};

/** 1 dòng "Đơn học sắp tới" (union student-side + tutor-side). */
type MineBooking = {
  id: string;
  tutorId: string;
  studentId: string;
  subjectSlug: string;
  startAt: Date;
  endAt: Date;
  status: string;
  // userTable.name nullable trong DB → giữ `| null` cho type honest (component chỉ
  // dùng `.length` của list, không render field này, nên null không ảnh hưởng render).
  tutorName: string | null;
  tutorAvatarUrl: string | null;
};

/** 1 dòng "Đơn đã apply" (chỉ khi user là tutor). */
type MineApplication = {
  id: string;
  requestId: string;
  status: string;
  proposedRateVnd: number;
  createdAt: Date;
  requestTitle: string;
  requestSubject: string;
  requestLevel: string;
  requestStatus: string;
};

export type MineTabData = {
  myProfile: MineProfile | null;
  myRequests: MineRequest[];
  upcomingBookings: MineBooking[];
  myApplications: MineApplication[];
};

/**
 * Bản CACHE (cache-aside, TTL 120s) + re-hydrate Date.
 *
 * `cached()` đã fail-open sẵn — KHÔNG bọc try/catch. Sau cache, mọi field Date đã
 * thành string (JSON) → map lại về `new Date(...)` để consumer dùng được như Date
 * thật (vd application gọi `.toISOString()`).
 */
export async function getMineTab(userId: string): Promise<MineTabData> {
  const data = await cached(ck.mineTab(userId), 120, () => fetchMineTab(userId));
  return {
    // profile.createdAt/updatedAt là Date trong type → re-hydrate giữ type honest.
    myProfile: data.myProfile
      ? {
          ...data.myProfile,
          createdAt: new Date(data.myProfile.createdAt),
          updatedAt: new Date(data.myProfile.updatedAt),
        }
      : null,
    myRequests: data.myRequests.map((r) => ({ ...r, createdAt: new Date(r.createdAt) })),
    upcomingBookings: data.upcomingBookings.map((b) => ({
      ...b,
      startAt: new Date(b.startAt),
      endAt: new Date(b.endAt),
    })),
    // consumer gọi `a.createdAt.toISOString()` → BẮT BUỘC Date thật.
    myApplications: data.myApplications.map((a) => ({ ...a, createdAt: new Date(a.createdAt) })),
  };
}

/** Truy vấn thật — chỉ chạy khi cache MISS. Giữ nguyên logic 4 query gốc. */
async function fetchMineTab(userId: string): Promise<MineTabData> {
  // Parallel fetch — profile + my requests không phụ thuộc nhau.
  const [profileRows, myRequests] = await Promise.all([
    dbReplica
      .select()
      .from(tutorProfile)
      .where(eq(tutorProfile.userId, userId))
      .limit(1),
    dbReplica
      .select({
        id: tutorRequest.id,
        title: tutorRequest.title,
        subjectSlug: tutorRequest.subjectSlug,
        level: tutorRequest.level,
        modality: tutorRequest.modality,
        urgency: tutorRequest.urgency,
        status: tutorRequest.status,
        budgetVnd: tutorRequest.budgetVnd,
        createdAt: tutorRequest.createdAt,
      })
      .from(tutorRequest)
      .where(eq(tutorRequest.studentId, userId))
      .orderBy(desc(tutorRequest.createdAt))
      .limit(10),
  ]);

  const myProfile = profileRows[0] ?? null;

  // Upcoming bookings — student-side + tutor-side (nếu user là tutor).
  const upcomingBookings = await dbReplica
    .select({
      id: tutoringBooking.id,
      tutorId: tutoringBooking.tutorId,
      studentId: tutoringBooking.studentId,
      subjectSlug: tutoringBooking.subjectSlug,
      startAt: tutoringBooking.startAt,
      endAt: tutoringBooking.endAt,
      status: tutoringBooking.status,
      tutorName: userTable.name,
      tutorAvatarUrl: tutorProfile.avatarUrl,
    })
    .from(tutoringBooking)
    .innerJoin(tutorProfile, eq(tutorProfile.id, tutoringBooking.tutorId))
    .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
    .where(
      and(
        gte(tutoringBooking.startAt, new Date()),
        myProfile
          ? or(
              eq(tutoringBooking.studentId, userId),
              eq(tutoringBooking.tutorId, myProfile.id),
            )
          : eq(tutoringBooking.studentId, userId),
      ),
    )
    .orderBy(asc(tutoringBooking.startAt))
    .limit(5);

  // Nếu có tutor profile → fetch applications tutor đã gửi.
  const myApplications = myProfile
    ? await dbReplica
        .select({
          id: tutorApplication.id,
          requestId: tutorApplication.requestId,
          status: tutorApplication.status,
          proposedRateVnd: tutorApplication.proposedRateVnd,
          createdAt: tutorApplication.createdAt,
          requestTitle: tutorRequest.title,
          requestSubject: tutorRequest.subjectSlug,
          requestLevel: tutorRequest.level,
          requestStatus: tutorRequest.status,
        })
        .from(tutorApplication)
        .innerJoin(tutorRequest, eq(tutorRequest.id, tutorApplication.requestId))
        .where(eq(tutorApplication.tutorId, myProfile.id))
        .orderBy(desc(tutorApplication.createdAt))
        .limit(10)
    : [];

  return { myProfile, myRequests, upcomingBookings, myApplications };
}
