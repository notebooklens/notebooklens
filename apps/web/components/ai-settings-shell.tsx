import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { WorkspaceTopbar } from "./workspace-topbar";
import { WorkspaceSettingsMenu } from "./workspace-settings-menu";
import styles from "./ai-gateway-settings.module.css";

export function AiSettingsShell({ context, reviewHref, children, authState = "unknown", loginHref, currentPath }: {
  context: string;
  reviewHref: string;
  children: ReactNode;
  authState?: "authenticated" | "signed-out" | "unknown";
  loginHref?: string;
  currentPath?: string;
}) {
  return (
    <div className={styles.page}>
      <WorkspaceTopbar skipHref="#ai-settings-main">
        <WorkspaceSettingsMenu authState={authState} loginHref={loginHref} returnTo={currentPath ?? reviewHref} aiSettingsHref={currentPath} />
      </WorkspaceTopbar>
      <header className={styles.header}>
        <div>
          <p><Link href={reviewHref as Route}>Back to review</Link></p>
          <p className={styles.breadcrumb}>{context}</p>
          <h1>AI review settings</h1>
          <p>Optional LiteLLM gateway for managed notebook reviews. Notebook diffs do not require AI.</p>
        </div>
      </header>
      <main id="ai-settings-main" className={styles.main} tabIndex={-1}>{children}</main>
    </div>
  );
}

export type AiSettingsRecoveryKind = "unauthenticated" | "forbidden" | "not-found" | "unavailable";

export function AiSettingsRecovery({ kind, context, reviewHref, currentPath, loginHref }: {
  kind: AiSettingsRecoveryKind;
  context: string;
  reviewHref: string;
  currentPath: string;
  loginHref: string;
}) {
  const content = {
    unauthenticated: {
      title: "Sign in to manage AI settings",
      detail: "Your GitHub session is missing or has expired. Sign in so NotebookLens can check your access. Signing in does not grant additional permissions.",
    },
    forbidden: {
      title: "AI settings access could not be verified",
      detail: "This account could not be verified as having access to these settings. Repository access is required; changing shared AI settings also requires the organization owner or the owner of a personal installation. Repository write access alone is not enough.",
    },
    "not-found": {
      title: "AI settings were not found",
      detail: "This review or its installation is unavailable. Check the review link or return Home to choose an accessible repository.",
    },
    unavailable: {
      title: "AI settings are temporarily unavailable",
      detail: "NotebookLens could not load or verify these settings. Try again, or return to your review. No settings were changed by this request.",
    },
  }[kind];
  return (
    <AiSettingsShell context={context} reviewHref={reviewHref} currentPath={currentPath} authState={kind === "unauthenticated" ? "signed-out" : "unknown"} loginHref={loginHref || undefined}>
      <section className={styles.section} aria-labelledby="ai-settings-recovery-title">
        <h2 id="ai-settings-recovery-title">{content.title}</h2>
        <p>{content.detail}</p>
        {kind === "forbidden" ? <p>If you expect access, sign in with the correct GitHub account or ask the installation owner to check your role. NotebookLens will check permissions again; it will not change them.</p> : null}
        <div className={styles.recoveryActions}>
          {kind === "unauthenticated" || kind === "forbidden" ? <a className={styles.primaryButton} href={loginHref}>{kind === "unauthenticated" ? "Continue with GitHub" : "Check GitHub access again"}</a> : null}
          {kind === "unavailable" ? <a className={styles.primaryButton} href={currentPath}>Try again</a> : null}
        </div>
      </section>
    </AiSettingsShell>
  );
}
