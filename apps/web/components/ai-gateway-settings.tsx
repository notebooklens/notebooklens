import Link from "next/link";

import { AiGatewaySettingsForm } from "@/components/ai-gateway-settings-form";
import { buildAiGatewayActionState } from "@/lib/ai-gateway";
import { buildSnapshotRoute } from "@/lib/review-workspace";
import type { AiGatewayConfig, WorkspaceReview } from "@/lib/types";
import styles from "./ai-gateway-settings.module.css";

type AiGatewaySettingsProps = {
  review: WorkspaceReview;
  config: AiGatewayConfig;
  currentPath: string;
};

export function AiGatewaySettings({ review, config, currentPath }: AiGatewaySettingsProps) {
  const reviewHref = buildSnapshotRoute(review.owner, review.repo, review.pull_number, null);
  const installationLabel = `${review.installation.account_login} (${review.installation.account_type})`;

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#ai-settings-main" tabIndex={0}>Skip to gateway settings</a>
      <header className={styles.header}>
        <div>
          <p className={styles.breadcrumb}>{review.owner}/{review.repo}</p>
          <h1>AI review settings</h1>
          <p>Optional LiteLLM gateway for managed notebook reviews. Notebook diffs do not require AI.</p>
        </div>
        <nav className={styles.headerLinks} aria-label="Workspace navigation">
          <Link className={styles.secondaryButton} href="/">Home</Link>
          <Link className={styles.secondaryButton} href={reviewHref}>Back to review</Link>
        </nav>
      </header>
      <main id="ai-settings-main" className={styles.main} tabIndex={-1}>
        <div className={styles.scopeNote}>
          <strong>Applies to {installationLabel}</strong>
          <p>Shared by all repositories and pull requests in this GitHub App installation.</p>
        </div>
        <AiGatewaySettingsForm
          initialState={buildAiGatewayActionState(config)}
          installationLabel={installationLabel}
          returnTo={currentPath}
        />
      </main>
    </div>
  );
}
