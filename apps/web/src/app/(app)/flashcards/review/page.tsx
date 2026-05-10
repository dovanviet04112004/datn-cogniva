/**
 * /flashcards/review — màn ôn flashcards. Wrapper page cho ReviewSession.
 */
import { ReviewSession } from '@/components/flashcards/review-session';

export const metadata = {
  title: 'Ôn flashcards · Cogniva',
};

export default function ReviewPage() {
  return (
    <div className="min-h-full p-6">
      <ReviewSession />
    </div>
  );
}
