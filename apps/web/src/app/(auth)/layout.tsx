import Link from 'next/link';
import { BrainCircuit } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/30 flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <Link href="/" className="flex items-center gap-2">
        <div className="bg-primary text-primary-foreground flex h-9 w-9 items-center justify-center rounded-md">
          <BrainCircuit className="h-5 w-5" />
        </div>
        <span className="text-lg font-semibold">Cogniva</span>
      </Link>
      {children}
    </div>
  );
}
