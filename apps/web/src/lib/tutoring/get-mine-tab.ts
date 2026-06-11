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

type MineProfile = typeof tutorProfile.$inferSelect;

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

type MineBooking = {
  id: string;
  tutorId: string;
  studentId: string;
  subjectSlug: string;
  startAt: Date;
  endAt: Date;
  status: string;
  tutorName: string | null;
  tutorAvatarUrl: string | null;
};

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

export async function getMineTab(userId: string): Promise<MineTabData> {
  const data = await cached(ck.mineTab(userId), 120, () => fetchMineTab(userId));
  return {
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
    myApplications: data.myApplications.map((a) => ({ ...a, createdAt: new Date(a.createdAt) })),
  };
}

async function fetchMineTab(userId: string): Promise<MineTabData> {
  const [profileRows, myRequests] = await Promise.all([
    dbReplica.select().from(tutorProfile).where(eq(tutorProfile.userId, userId)).limit(1),
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
          ? or(eq(tutoringBooking.studentId, userId), eq(tutoringBooking.tutorId, myProfile.id))
          : eq(tutoringBooking.studentId, userId),
      ),
    )
    .orderBy(asc(tutoringBooking.startAt))
    .limit(5);

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
