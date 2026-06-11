'use client';

import * as React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { captureError } from '@/lib/observability/sentry';

type Props = {
  children: React.ReactNode;
};

type State = {
  error: Error | null;
};

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[error-boundary]', error, info);
    captureError(error, {
      route: typeof window !== 'undefined' ? window.location.pathname : undefined,
    });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <AlertTriangle className="text-destructive mx-auto h-12 w-12" />
          <div>
            <h1 className="text-xl font-semibold">Có lỗi xảy ra</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Chúng tôi đã ghi nhận lỗi và sẽ xử lý sớm. Bạn có thể reload trang để thử lại.
            </p>
          </div>
          <details className="bg-muted/30 rounded-md p-3 text-left text-xs">
            <summary className="text-muted-foreground cursor-pointer">Chi tiết lỗi</summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap">{this.state.error.message}</pre>
          </details>
          <Button onClick={this.reset}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Thử lại
          </Button>
        </div>
      </div>
    );
  }
}
