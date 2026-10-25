"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import type { FormState } from "@/app/actions";

/**
 * A form bound to a server action that shows the result inline. If the action
 * returns a `secret` (setup code, cabinet key) it is shown once, large, with a
 * copy button.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  className,
  resetOnSuccess = true,
  variant = "primary",
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  submitLabel: string;
  children?: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  variant?: "primary" | "secondary";
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={ref} action={formAction} className={className ?? "form"}>
      {children}
      <div className="form-actions">
        <button type="submit" className={`btn btn-${variant}`} disabled={pending}>
          {pending ? "…" : submitLabel}
        </button>
        {state?.message && !state.secret && (
          <span role="status" className={state.ok ? "msg msg-ok" : "msg msg-err"}>
            {state.message}
          </span>
        )}
      </div>
      {state?.secret && (
        <div className="secret" role="status">
          <code>{state.secret}</code>
          <button type="button" className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(state.secret!)}>
            ⧉
          </button>
          {state.message && <p className="muted">{state.message}</p>}
        </div>
      )}
    </form>
  );
}
