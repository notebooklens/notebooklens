import Link from "next/link";
import type { ReactNode } from "react";

/** Shared navigation chrome. Page-specific controls belong below this bar. */
export function WorkspaceTopbar({ children, skipHref }: {
  children?: ReactNode;
  skipHref?: string;
}) {
  return (
    <nav className="workspace-topbar" aria-label="Workspace navigation">
      {skipHref ? <a className="workspace-skip-link" href={skipHref} tabIndex={0}>Skip to main content</a> : null}
      <div className="workspace-home-links">
        <Link className="workspace-brand" href="/">NotebookLens</Link>
        <Link className="text-link" href="/">Home</Link>
      </div>
      {children ? <div className="workspace-topbar-actions">{children}</div> : null}
    </nav>
  );
}
