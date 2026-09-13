"use client";

import { useRef, useState, type ComponentProps, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Props = ComponentProps<"form"> & { pendingLabel?: string; onSuccess?: () => void };

/** Progressive form enhancement. Failed submissions never navigate away from drafts. */
export function ThreadMutationForm({ children, pendingLabel = "Posting…", onSuccess, ...props }: Props) {
  const router = useRouter();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginHref, setLoginHref] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    submitting.current = true;
    setPending(true);
    setError(null);
    setLoginHref(null);
    setSuccess(null);
    try {
      const response = await fetch(form.action, {
        method: "POST",
        body: data,
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        redirect: "error",
      });
      const result = await response.json() as { ok?: boolean; message?: string; redirectTo?: string; loginHref?: string };
      if (!response.ok || result.ok !== true) {
        setError(typeof result.message === "string" ? result.message : "Comment not saved. Your draft has been kept.");
        if (isLocalPath(result.loginHref)) setLoginHref(result.loginHref);
        return;
      }
      if (!isLocalPath(result.redirectTo)) throw new Error("Invalid action destination");
      form.reset();
      for (const textarea of form.querySelectorAll("textarea")) {
        textarea.value = "";
        textarea.defaultValue = "";
      }
      onSuccess?.();
      setSuccess(result.message ?? "Saved.");
      // Refresh server data without destroying other in-memory comment drafts.
      try {
        // Enhanced forms announce success locally. Keep fallback redirect flashes
        // for plain HTML submissions, not as a persistent page-wide banner.
        const destination = new URL(result.redirectTo, window.location.origin);
        destination.searchParams.delete("flash");
        destination.searchParams.delete("message");
        router.replace(`${destination.pathname}${destination.search}${destination.hash}`, { scroll: false });
        router.refresh();
      } catch {
        setError("The action was saved, but the discussion could not refresh. Reload to see it; do not submit it again.");
      }
    } catch {
      setError("Could not confirm that the action completed. Your draft has been kept. Check the discussion before retrying.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return <form {...props} method="post" onSubmit={(event) => { void submit(event); }} aria-busy={pending}>
    <fieldset className="thread-mutation-fields" disabled={pending}>{children}</fieldset>
    {pending ? <p role="status" className="muted-copy">{pendingLabel}</p> : null}
    {success ? <p role="status">{success}</p> : null}
    {error ? <div role="alert" className="thread-mutation-error">
      <p>{error}</p>
      {loginHref ? <a href={loginHref} target="_blank" rel="noreferrer">Sign in again in a new tab, then retry here</a> : null}
    </div> : null}
  </form>;
}

function isLocalPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !/[\\\s\u0000-\u001f\u007f]/.test(value);
}
