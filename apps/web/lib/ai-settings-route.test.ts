import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions", () => ({ submitAiGatewaySettingsAction: vi.fn() }));
vi.mock("@/lib/api", () => ({
  ApiRequestError: class extends Error {
    constructor(public status: number, public detail: string) { super(detail); }
  },
  buildLoginHref: vi.fn(),
  getReviewWorkspace: vi.fn(), getAiGatewaySettings: vi.fn(),
}));
import AiGatewaySettingsPage from "@/app/reviews/[owner]/[repo]/pulls/[pullNumber]/settings/ai-gateway/page";
import { AiGatewaySettings } from "@/components/ai-gateway-settings";
import { ApiRequestError, buildLoginHref, getAiGatewaySettings, getReviewWorkspace } from "@/lib/api";
import { buildRow, buildWorkspace } from "../e2e/workspace-fixture";

const params = Promise.resolve({ owner: "example", repo: "notebooks", pullNumber: "7" });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(buildLoginHref).mockImplementation((path) => `/api/auth/github/login?next_path=${encodeURIComponent(path)}`);
  vi.mocked(getReviewWorkspace).mockResolvedValue(buildWorkspace(buildRow()));
});

describe("AI settings route recovery", () => {
  for (const stage of ["workspace", "settings"] as const) {
    for (const [status, title] of [
      [401, "Sign in to manage AI settings"],
      [403, "AI settings access could not be verified"],
      [404, "AI settings were not found"],
      [502, "AI settings are temporarily unavailable"],
    ] as const) {
      it(`${stage} ${status} retains navigation without raw errors or editable settings`, async () => {
        const mock = stage === "workspace" ? getReviewWorkspace : getAiGatewaySettings;
        vi.mocked(mock).mockRejectedValue(new ApiRequestError(status, "SYNTHETIC_PRIVATE_UPSTREAM_MARKER"));
        const html = renderToStaticMarkup(await AiGatewaySettingsPage({ params }));
        expect(html).toContain(title);
        expect(html).toContain('href="/">Home</a>');
        expect(html).toContain('href="/reviews/example/notebooks/pulls/7">Back to review</a>');
        expect(html).toContain('id="ai-settings-main"');
        expect(html).not.toContain("SYNTHETIC_PRIVATE_UPSTREAM_MARKER");
        expect(html).not.toContain('name="apiKey"');
        expect(html).not.toContain("hero-card");
        if (status === 401 || status === 403) expect(html).toContain("next_path=%2Freviews%2Fexample%2Fnotebooks%2Fpulls%2F7%2Fsettings%2Fai-gateway");
        if (status === 403) expect(html).toContain("Repository write access alone is not enough");
        if (status === 502) expect(html).toContain("Try again");
        if (stage === "workspace") expect(getAiGatewaySettings).not.toHaveBeenCalled();
      });
    }
  }
  it("renders bounded recovery for transport failures", async () => {
    vi.mocked(getAiGatewaySettings).mockRejectedValue(new TypeError("SYNTHETIC_PRIVATE_TRANSPORT_MARKER"));
    const html = renderToStaticMarkup(await AiGatewaySettingsPage({ params }));
    expect(html).toContain("AI settings are temporarily unavailable");
    expect(html).not.toContain("SYNTHETIC_PRIVATE_TRANSPORT_MARKER");
    expect(buildLoginHref).not.toHaveBeenCalled();
  });
  it("keeps recovery usable when the API origin/login configuration is broken", async () => {
    vi.mocked(getReviewWorkspace).mockRejectedValue(new ApiRequestError(401, "Authentication required"));
    vi.mocked(buildLoginHref).mockImplementation(() => { throw new Error("SYNTHETIC_CONFIGURATION_MARKER"); });
    const html = renderToStaticMarkup(await AiGatewaySettingsPage({ params }));
    expect(html).toContain("AI settings are temporarily unavailable");
    expect(html).toContain('href="/">Home</a>');
    expect(html).toContain("Back to review");
    expect(html).toContain("Try again");
    expect(html).not.toContain("SYNTHETIC_CONFIGURATION_MARKER");
    expect(html).not.toContain("Continue with GitHub");
  });
  it("keeps successful authorized settings on the existing form", async () => {
    vi.mocked(getAiGatewaySettings).mockResolvedValue({ config: {} } as Awaited<ReturnType<typeof getAiGatewaySettings>>);
    const element = await AiGatewaySettingsPage({ params });
    expect(element.type).toBe(AiGatewaySettings);
    expect(getAiGatewaySettings).toHaveBeenCalledWith(buildWorkspace(buildRow()).review.installation.id);
  });
});
