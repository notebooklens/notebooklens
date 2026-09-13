import { notFound } from "next/navigation";

import { ApiRequestError, buildLoginHref, getReviewWorkspace, getSnapshotWorkspace } from "@/lib/api";
import { readFlashNotice } from "@/lib/review-workspace";
import { ReviewWorkspace } from "@/components/review-workspace";
import { WorkspaceTopbar } from "@/components/workspace-topbar";
import { WorkspaceSettingsMenu } from "@/components/workspace-settings-menu";

type ReviewRouteProps = {
  owner: string;
  repo: string;
  pullNumber: number;
  snapshotIndex?: number;
  currentPath: string;
  searchParams: Record<string, string | string[] | undefined>;
};

export async function ReviewRoute(props: ReviewRouteProps) {
  const { currentPath, owner, pullNumber, repo, searchParams, snapshotIndex } = props;
  try {
    const workspace = snapshotIndex === undefined
      ? await getReviewWorkspace(owner, repo, pullNumber)
      : await getSnapshotWorkspace(owner, repo, pullNumber, snapshotIndex);
    return <ReviewWorkspace currentPath={currentPath} flashNotice={readFlashNotice(searchParams)} workspace={workspace} />;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    let kind: "signin" | "forbidden" | "unavailable" = error instanceof ApiRequestError && error.status === 401
      ? "signin" : error instanceof ApiRequestError && error.status === 403 ? "forbidden" : "unavailable";
    let loginHref: string | null = null;
    if (kind === "signin") {
      try { loginHref = buildLoginHref(currentPath); } catch { kind = "unavailable"; }
    }
    return <ReviewRecovery {...props} kind={kind} loginHref={loginHref} />;
  }
}

export function ReviewRecovery({ owner, repo, pullNumber, snapshotIndex, currentPath, kind, loginHref }: ReviewRouteProps & {
  kind: "signin" | "forbidden" | "unavailable";
  loginHref: string | null;
}) {
  const context = `${owner}/${repo} · PR #${pullNumber}${snapshotIndex === undefined ? "" : ` · Push ${snapshotIndex}`}`;
  const heading = kind === "signin" ? "Sign in to open this review"
    : kind === "forbidden" ? "Review access could not be verified" : "This review is temporarily unavailable";
  return <div className="workspace-shell notebook-document-workspace">
    <WorkspaceTopbar skipHref="#review-recovery">
      <WorkspaceSettingsMenu authState={kind === "signin" ? "signed-out" : "unknown"} loginHref={loginHref ?? undefined} returnTo={currentPath} />
    </WorkspaceTopbar>
    <main id="review-recovery" tabIndex={-1} className="summary-card">
      <p className="muted-copy">{context}</p>
      <h1>{heading}</h1>
      <p>{kind === "signin"
        ? "Continue with GitHub to check your repository access and return to this same review."
        : kind === "forbidden"
        ? "Your current GitHub account could not be verified as having access to this repository. Return Home to choose an accessible repository, or check your account and repository permissions."
        : "NotebookLens could not load this review. Try again, or use Home to choose another review."}</p>
      {kind === "signin" && loginHref ? <a className="primary-button" href={loginHref}>Continue with GitHub</a> : null}
      {kind === "unavailable" ? <a className="secondary-button" href={currentPath}>Try again</a> : null}
    </main>
  </div>;
}
