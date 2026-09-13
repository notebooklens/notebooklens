import { AiGatewaySettings } from "@/components/ai-gateway-settings";
import { AiSettingsRecovery, type AiSettingsRecoveryKind } from "@/components/ai-settings-shell";
import { ApiRequestError, buildLoginHref, getAiGatewaySettings, getReviewWorkspace } from "@/lib/api";
import { buildAiGatewayRoute, buildSnapshotRoute } from "@/lib/review-workspace";


type PageProps = {
  params: Promise<{
    owner: string;
    repo: string;
    pullNumber: string;
  }>;
};


export default async function AiGatewaySettingsPage({ params }: PageProps) {
  const routeParams = await params;
  const pullNumber = Number(routeParams.pullNumber);
  const currentPath = buildAiGatewayRoute(
    routeParams.owner,
    routeParams.repo,
    pullNumber,
  );
  const recovery = (kind: AiSettingsRecoveryKind) => {
    let loginHref = "";
    if (kind === "unauthenticated" || kind === "forbidden") {
      try {
        loginHref = buildLoginHref(currentPath);
      } catch {
        // A broken API origin must not break the error page too. Local Home,
        // Back and retry remain usable; never invent an OAuth endpoint.
        kind = "unavailable";
      }
    }
    return (
      <AiSettingsRecovery
        kind={kind}
        context={`${routeParams.owner}/${routeParams.repo}`}
        reviewHref={buildSnapshotRoute(routeParams.owner, routeParams.repo, pullNumber, null)}
        currentPath={currentPath}
        loginHref={loginHref}
      />
    );
  };

  try {
    const workspace = await getReviewWorkspace(
      routeParams.owner,
      routeParams.repo,
      pullNumber,
    );
    const settings = await getAiGatewaySettings(workspace.review.installation.id);

    return (
      <AiGatewaySettings
        config={settings.config}
        currentPath={currentPath}
        review={workspace.review}
      />
    );
  } catch (error) {
    if (error instanceof ApiRequestError) {
      if (error.status === 401) {
        return recovery("unauthenticated");
      }
      if (error.status === 403) return recovery("forbidden");
      if (error.status === 404) return recovery("not-found");
    }
    return recovery("unavailable");
  }
}
