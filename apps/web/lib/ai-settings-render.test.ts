import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions", () => ({ submitAiGatewaySettingsAction: vi.fn() }));
import { AiGatewaySettings } from "@/components/ai-gateway-settings";
import { buildRow, buildWorkspace } from "../e2e/workspace-fixture";
import type { AiGatewayConfig } from "@/lib/types";

describe("AI gateway settings rendering", () => {
  it("shows installation scope and stored-secret status without displaying secret values", () => {
    const config: AiGatewayConfig = {
      installation_id: "synthetic-installation", provider_kind: "litellm", display_name: "Research gateway",
      github_host_kind: "github_com", github_api_base_url: "https://api.github.com", github_web_base_url: "https://github.com",
      base_url: "https://gateway.example/v1", model_name: "review-model", api_key_header_name: "Authorization",
      has_api_key: true, static_header_names: ["X-Research-Team"], use_responses_api: false,
      litellm_virtual_key_id: null, active: false, updated_by_github_user_id: 101, updated_at: "2026-09-13T00:00:00Z",
    };
    const html = renderToStaticMarkup(createElement(AiGatewaySettings, { review: buildWorkspace(buildRow()).review, config, currentPath: "/reviews/example/ai" }));
    expect(html).toContain("Shared by all repositories and pull requests");
    expect(html).toContain("A key is stored. Its value is never shown");
    expect(html).toMatch(/name="apiKey"[^>]*value=""/);
    expect(html).toContain("Save updates settings without running a connection test");
    expect(html).toContain("Testing does not save or activate the gateway");
    expect(html).toContain("Skip to gateway settings");
    expect(html).toContain('aria-label="Workspace navigation"');
    expect(html).toMatch(/href="\/">Home<\/a>/);
    expect(html).toContain("Back to review");
    expect(html).toContain('role="status"');
    expect(html).not.toMatch(/<details[^>]*open/);
  });
});
