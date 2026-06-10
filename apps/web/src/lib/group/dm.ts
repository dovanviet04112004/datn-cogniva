/**
 * DM helpers — order user IDs để unique cặp không phụ thuộc thứ tự.
 */

/** Trả [smaller, larger] theo lexicographic. */
export function orderUserIds(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** True nếu uid là 1 trong 2 thành viên của thread. */
export function isThreadMember(thread: { user1Id: string; user2Id: string }, uid: string): boolean {
  return thread.user1Id === uid || thread.user2Id === uid;
}
