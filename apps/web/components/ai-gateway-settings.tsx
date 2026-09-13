import { AiGatewaySettingsForm } from "@/components/ai-gateway-settings-form";
import { AiSettingsShell } from "@/components/ai-settings-shell";
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
    <AiSettingsShell context={`${review.owner}/${review.repo}`} reviewHref={reviewHref} currentPath={currentPath} authState="authenticated">
        <div className={styles.scopeNote}>
          <strong>Applies to {installationLabel}</strong>
          <p>Shared by all repositories and pull requests in this GitHub App installation.</p>
        </div>
        <AiGatewaySettingsForm
          initialState={buildAiGatewayActionState(config)}
          installationLabel={installationLabel}
          returnTo={currentPath}
        />
    </AiSettingsShell>
  );
}
