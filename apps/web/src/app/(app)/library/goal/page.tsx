/**
 * /library/goal → redirect về /library hub (unified search có mode goal).
 * Giữ route để backward-compat với deep-links cũ.
 */
import { redirect } from 'next/navigation';

export default function LibraryGoalRedirect() {
  redirect('/library');
}
