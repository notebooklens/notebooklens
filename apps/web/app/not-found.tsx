import { WorkspaceTopbar } from "@/components/workspace-topbar";

export default function NotFoundPage() {
  return <div className="workspace-shell notebook-document-workspace">
    <WorkspaceTopbar skipHref="#not-found-main" />
    <main id="not-found-main" tabIndex={-1} className="summary-card">
      <h1>Page not found</h1>
      <p>This link is unavailable or no longer exists. Use Home to choose a repository and open a review you can access.</p>
    </main>
  </div>;
}
