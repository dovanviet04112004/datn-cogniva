export function orderUserIds(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function isThreadMember(thread: { user1Id: string; user2Id: string }, uid: string): boolean {
  return thread.user1Id === uid || thread.user2Id === uid;
}
