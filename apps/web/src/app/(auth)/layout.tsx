/**
 * Layout cho route group (auth) — bao 2 trang sign-in và sign-up.
 *
 * Cố ý đơn giản: nền muted, logo trên cùng, form ở giữa. Không có nav vì
 * mục tiêu duy nhất ở đây là hoàn tất đăng ký/đăng nhập.
 */
import Link from 'next/link';
import { BrainCircuit } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-muted/30 p-6">
      <Link href="/" className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <BrainCircuit className="h-5 w-5" />
        </div>
        <span className="text-lg font-semibold">Cogniva</span>
      </Link>
      {children}
    </div>
  );
}
