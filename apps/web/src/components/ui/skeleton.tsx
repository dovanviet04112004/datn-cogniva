/**
 * Skeleton — placeholder lờ mờ với animation pulse, dùng khi đang load data.
 *
 * Cách dùng: thay thế cho phần UI sẽ render sau, giữ kích thước tương đương
 * để tránh layout shift.
 *   {isLoading ? <Skeleton className="h-8 w-32" /> : <span>{name}</span>}
 */
import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

export { Skeleton };
