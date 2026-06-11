'use client';

import * as React from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PromptDialog } from '@/components/ui/prompt-dialog';

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'destructive' | 'default';
};

export type PromptOptions = {
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  required?: boolean;
  multiline?: boolean;
};

type Resolver = (ok: boolean) => void;
type PromptResolver = (value: string | null) => void;

type Ctx = (opts: ConfirmOptions) => Promise<boolean>;
type PromptCtx = (opts: PromptOptions) => Promise<string | null>;

const ConfirmContext = React.createContext<Ctx | null>(null);
const PromptContext = React.createContext<PromptCtx | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<(ConfirmOptions & { resolver: Resolver }) | null>(null);

  const confirm: Ctx = React.useCallback((opts) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...opts, resolver: resolve });
    });
  }, []);

  const handleConfirm = React.useCallback(() => {
    state?.resolver(true);
    setState(null);
  }, [state]);

  const handleCancel = React.useCallback(
    (open: boolean) => {
      if (open) return;
      state?.resolver(false);
      setState(null);
    },
    [state],
  );

  const [pState, setPState] = React.useState<(PromptOptions & { resolver: PromptResolver }) | null>(
    null,
  );

  const prompt: PromptCtx = React.useCallback((opts) => {
    return new Promise<string | null>((resolve) => {
      setPState({ ...opts, resolver: resolve });
    });
  }, []);

  const handlePromptSubmit = React.useCallback(
    (value: string) => {
      pState?.resolver(value);
      setPState(null);
    },
    [pState],
  );

  const handlePromptCancel = React.useCallback(
    (open: boolean) => {
      if (open) return;
      pState?.resolver(null);
      setPState(null);
    },
    [pState],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      <PromptContext.Provider value={prompt}>
        {children}
        <ConfirmDialog
          open={!!state}
          onOpenChange={handleCancel}
          title={state?.title ?? ''}
          description={state?.description}
          confirmLabel={state?.confirmLabel}
          cancelLabel={state?.cancelLabel}
          variant={state?.variant}
          onConfirm={handleConfirm}
        />
        <PromptDialog
          open={!!pState}
          onOpenChange={handlePromptCancel}
          title={pState?.title ?? ''}
          description={pState?.description}
          placeholder={pState?.placeholder}
          defaultValue={pState?.defaultValue}
          confirmLabel={pState?.confirmLabel}
          cancelLabel={pState?.cancelLabel}
          required={pState?.required}
          multiline={pState?.multiline}
          onSubmit={handlePromptSubmit}
        />
      </PromptContext.Provider>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Ctx {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm phải dùng trong <ConfirmProvider>');
  }
  return ctx;
}

export function usePrompt(): PromptCtx {
  const ctx = React.useContext(PromptContext);
  if (!ctx) {
    throw new Error('usePrompt phải dùng trong <ConfirmProvider>');
  }
  return ctx;
}
