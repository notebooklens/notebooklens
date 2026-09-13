"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { buildWorkspaceActionPath } from "@/lib/review-workspace";

export function WorkspaceSettingsMenu({ authState, login, loginHref, returnTo, aiSettingsHref }: {
  authState: "authenticated" | "signed-out" | "unknown";
  login?: string;
  loginHref?: string;
  returnTo: string;
  aiSettingsHref?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && ref.current && !ref.current.contains(event.target)) ref.current.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, []);
  return <details ref={ref} className="workspace-menu workspace-menu-end" onKeyDown={event => {
    if (event.key === "Escape" && ref.current?.open) {
      event.preventDefault();
      ref.current.open = false;
      ref.current.querySelector("summary")?.focus();
    }
  }} onClick={event => {
    if ((event.target as Element).closest("a,button") && ref.current) ref.current.open = false;
  }}>
    <summary><span aria-hidden="true">☰</span> Settings</summary>
    <div className="workspace-menu-panel">
      <h2>Account &amp; settings</h2>
      {authState === "authenticated" && login ? <p>Signed in as {login}</p> : null}
      <div className="workspace-settings-actions">
        {aiSettingsHref ? <a className="text-link" href={aiSettingsHref}>Open team AI settings</a> : null}
        {loginHref ? <a className="text-link" href={loginHref}>{authState === "authenticated" ? "Refresh GitHub access" : "Sign in with GitHub"}</a> : null}
        {authState === "authenticated" ? <form action={buildWorkspaceActionPath("logout")} method="post">
          <input name="returnTo" type="hidden" value={returnTo} />
          <button className="workspace-topbar-action" type="submit">Sign out</button>
        </form> : !loginHref ? <Link className="text-link" href="/">{authState === "unknown" ? "Go to Home to check access" : "Go to Home to sign in"}</Link> : null}
      </div>
    </div>
  </details>;
}
