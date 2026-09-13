import React from "react";
import { createRoot } from "react-dom/client";
import { AiGatewaySettings } from "../components/ai-gateway-settings";
import { buildRow, buildWorkspace } from "./workspace-fixture";
import type { AiGatewayConfig } from "../lib/types";

const config: AiGatewayConfig = {
  installation_id: "synthetic-installation", provider_kind: "litellm", display_name: "Research gateway",
  github_host_kind: "github_com", github_api_base_url: "https://api.github.com", github_web_base_url: "https://github.com",
  base_url: "https://gateway.example/v1", model_name: "review-model", api_key_header_name: "Authorization",
  has_api_key: true, static_header_names: ["X-Research-Team"], use_responses_api: false,
  litellm_virtual_key_id: null, active: false, updated_by_github_user_id: 101, updated_at: "2026-09-13T00:00:00Z",
};
if (location.search.includes("empty")) { config.base_url = null; config.model_name = null; config.has_api_key = false; config.static_header_names = []; }
createRoot(document.getElementById("root")!).render(<AiGatewaySettings review={buildWorkspace(buildRow()).review} config={config} currentPath="/reviews/example/research/pulls/7/ai" />);
