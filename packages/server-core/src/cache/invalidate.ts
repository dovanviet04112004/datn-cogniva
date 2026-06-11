import { cacheDelete, bumpCacheVersion } from './cache-aside';
import { ck, TAG_LIBRARY } from './keys';
import { lbIncr } from './leaderboard';

export async function onXpChanged(userId: string, xpDelta: number): Promise<void> {
  await lbIncr(userId, xpDelta);
  await cacheDelete(ck.dashboard(userId), ck.profileMe(userId), ck.profilePublic(userId));
}

export async function onDashboardChanged(userId: string): Promise<void> {
  await cacheDelete(ck.dashboard(userId));
}

export async function onAnalyticsChanged(userId: string): Promise<void> {
  await cacheDelete(ck.analytics(userId));
}

export async function onKarmaChanged(): Promise<void> {
  await cacheDelete(ck.karmaBoard());
}

export async function onLibraryCatalogChanged(): Promise<void> {
  await cacheDelete(ck.universities(), ck.libraryHubStats());
  await bumpCacheVersion(TAG_LIBRARY);
}

export async function onStudyPlanChanged(userId: string, day: string): Promise<void> {
  await cacheDelete(ck.studyPlan(userId, day));
}

export async function onWalletChanged(userId: string): Promise<void> {
  await cacheDelete(ck.wallet(userId));
}

export async function onProfileChanged(userId: string): Promise<void> {
  await cacheDelete(ck.profileMe(userId), ck.profilePublic(userId));
}

export async function onWorkspaceChanged(userId: string): Promise<void> {
  await cacheDelete(ck.workspaces(userId), ck.dashboard(userId));
}

export async function onWorkspaceContentChanged(
  userId: string,
  workspaceId: string,
): Promise<void> {
  await cacheDelete(ck.workspaceStats(userId, workspaceId), ck.workspaceAtoms(userId, workspaceId));
}

export async function onDocumentChanged(
  userId: string,
  workspaceId?: string | null,
): Promise<void> {
  await cacheDelete(
    ck.documents(userId),
    ck.workspaces(userId),
    ck.graph(userId, 'all'),
    ck.dashboard(userId),
  );
  if (workspaceId) {
    await cacheDelete(
      ck.graph(userId, workspaceId),
      ck.workspaceStats(userId, workspaceId),
      ck.workspaceAtoms(userId, workspaceId),
    );
  }
}

export async function onAtomChanged(userId: string, atomId: string): Promise<void> {
  await cacheDelete(ck.atomView(userId, atomId));
}

export async function onFlashcardChanged(
  userId: string,
  workspaceId?: string | null,
): Promise<void> {
  await cacheDelete(ck.flashcardStats(userId), ck.dashboard(userId));
  if (workspaceId) {
    await cacheDelete(
      ck.workspaceStats(userId, workspaceId),
      ck.workspaceAtoms(userId, workspaceId),
    );
  }
}

export async function onExamChanged(userId: string, workspaceId?: string | null): Promise<void> {
  await cacheDelete(ck.exams(userId, 'all'), ck.exams(userId, workspaceId ?? 'all'));
  if (workspaceId) await cacheDelete(ck.workspaceStats(userId, workspaceId));
}

export async function onGroupChanged(groupId: string): Promise<void> {
  await cacheDelete(ck.groupDetail(groupId), ck.groupMembers(groupId));
}

export async function onGroupMembershipChanged(userId: string, groupId: string): Promise<void> {
  await cacheDelete(ck.groupsList(userId), ck.groupDetail(groupId), ck.groupMembers(groupId));
}

export async function onGroupReadChanged(groupId: string, userId: string): Promise<void> {
  await cacheDelete(ck.groupUnread(groupId, userId));
}

export async function onRoomChanged(userId: string): Promise<void> {
  await cacheDelete(ck.roomsList(userId));
}

export async function onRoomRecordingsChanged(roomId: string): Promise<void> {
  await cacheDelete(ck.roomRecordings(roomId));
}

export async function onConversationsChanged(userId: string): Promise<void> {
  await cacheDelete(ck.conversationsList(userId));
}

export async function onTutoringMineChanged(userId: string): Promise<void> {
  await cacheDelete(ck.mineTab(userId));
}

export async function onGraphChanged(userId: string): Promise<void> {
  await cacheDelete(ck.graph(userId, 'all'));
}

export async function onMasteryChanged(
  userId: string,
  workspaceId?: string | null,
  conceptId?: string | null,
): Promise<void> {
  await cacheDelete(ck.graph(userId, 'all'));
  if (workspaceId) await cacheDelete(ck.workspaceAtoms(userId, workspaceId));
  if (conceptId) await cacheDelete(ck.atomView(userId, conceptId));
}

export async function onLibraryImportChanged(): Promise<void> {
  await cacheDelete(ck.libraryHubStats());
}
