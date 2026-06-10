/**
 * /library/reverse → redirect về /library hub.
 */
import { redirect } from 'next/navigation';

export default function LibraryReverseRedirect() {
  redirect('/library');
}
