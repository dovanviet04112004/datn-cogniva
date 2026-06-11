'use client';

import { BrainCircuit } from 'lucide-react';

import { FlashcardSessionV8 } from './flashcard-session-v8';

export function FlashcardView({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="flex h-full flex-col">
      <header className="bg-muted/20 shrink-0 border-b px-4 py-2 pr-12">
        <div className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
          <BrainCircuit className="text-primary h-3 w-3" />
          Ôn flashcard · scope workspace
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <FlashcardSessionV8 workspaceId={workspaceId} />
      </div>
    </div>
  );
}
