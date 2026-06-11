export const ck = {
  analytics: (u: string) => `analytics:v1:${u}:30d`,
  dashboard: (u: string) => `dashboard:v1:${u}`,
  profileMe: (u: string) => `profile:v1:${u}`,
  wallet: (u: string) => `wallet:v1:${u}`,
  studyPlan: (u: string, day: string) => `study-plan:v1:${u}:${day}`,
  profilePublic: (u: string) => `profile-pub:v1:${u}`,

  workspaces: (u: string) => `workspaces:v1:${u}`,
  workspaceStats: (u: string, ws: string) => `ws-stats:v1:${u}:${ws}`,
  workspaceAtoms: (u: string, ws: string) => `ws-atoms:v1:${u}:${ws}`,
  atomView: (u: string, atomId: string) => `atom-view:v1:${u}:${atomId}`,
  documents: (u: string) => `documents:v1:${u}`,
  flashcardStats: (u: string) => `flashcard-stats:v1:${u}`,
  exams: (u: string, ws: string) => `exams:v1:${u}:${ws}`,
  graph: (u: string, ws: string) => `graph:v1:${u}:${ws}`,
  groupsList: (u: string) => `groups:v1:${u}`,
  groupUnread: (g: string, u: string) => `group-unread:v1:${g}:${u}`,
  conversationsList: (u: string) => `conversations:v1:${u}`,
  mineTab: (u: string) => `tutoring-mine:v1:${u}`,

  groupDetail: (g: string) => `group-detail:v1:${g}`,
  groupMembers: (g: string) => `group-members:v1:${g}`,
  roomRecordings: (r: string) => `room-recordings:v1:${r}`,
  roomsList: (u: string) => `rooms:v1:${u}`,

  karmaBoard: () => `library:v1:karma-board`,
  universities: () => `library:v1:universities`,
  libraryHubStats: () => `library:v1:hub-stats`,

  courseDetail: (id: string, ver: number) => `library:v1:course:${id}:${ver}`,
  universityDetail: (id: string, ver: number) => `library:v1:university:${id}:${ver}`,
  libraryDocsFeed: (filterHash: string, ver: number) => `library:v1:docs:${filterHash}:${ver}`,
  libraryDocDetail: (id: string, ver: number) => `library:v1:doc:${id}:${ver}`,

  tutorsBrowse: (filterHash: string) => `tutoring:v1:tutors:${filterHash}`,
  tutoringRequests: (filterHash: string) => `tutoring:v1:requests:${filterHash}`,
} as const;

export const LB_XP = 'lb:xp:v1';

export const TAG_LIBRARY = 'library:catalog';
