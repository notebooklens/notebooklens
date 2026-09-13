import { cookies } from "next/headers";

import type {
  AiGatewaySettingsResponse,
  WorkspacePayload,
  WorkspaceApiPayload,
  SessionIdentity,
  RepositoryPage,
} from "@/lib/types";


export class ApiRequestError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiRequestError";
    this.status = status;
    this.detail = detail;
  }
}


export class ApiConfigurationError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "ApiConfigurationError";
  }
}


export async function getReviewWorkspace(
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<WorkspacePayload> {
  return normalizeWorkspacePayload(await apiRequest<WorkspaceApiPayload>(
    `/api/reviews/${owner}/${repo}/pulls/${pullNumber}`,
  ));
}

export async function getSessionIdentity(): Promise<SessionIdentity> {
  return apiRequest<SessionIdentity>("/api/session");
}

export async function getRepositories(cursor?: string): Promise<RepositoryPage> {
  const query = new URLSearchParams({ limit: "10" });
  if (cursor) query.set("cursor", cursor);
  return apiRequest<RepositoryPage>(`/api/repositories?${query.toString()}`);
}


export async function getSnapshotWorkspace(
  owner: string,
  repo: string,
  pullNumber: number,
  snapshotIndex: number,
): Promise<WorkspacePayload> {
  return normalizeWorkspacePayload(await apiRequest<WorkspaceApiPayload>(
    `/api/reviews/${owner}/${repo}/pulls/${pullNumber}/snapshots/${snapshotIndex}`,
  ));
}

export function normalizeWorkspacePayload(payload: WorkspaceApiPayload): WorkspacePayload {
  return {
    ...payload,
    threads: (payload.threads ?? []).map(({ github_mirror, ...thread }) => ({
      ...thread,
      // A nested response is authoritative, including explicit nulls. Legacy
      // flat fixtures/responses remain readable during rolling deployments.
      ...(github_mirror ? {
        github_mirror_state: github_mirror.state,
        github_root_comment_id: github_mirror.root_comment_id,
        github_root_comment_url: github_mirror.root_comment_url,
        github_last_mirrored_at: github_mirror.last_mirrored_at,
      } : {}),
    })),
  };
}


export async function getAiGatewaySettings(
  installationId: string,
): Promise<AiGatewaySettingsResponse> {
  return apiRequest<AiGatewaySettingsResponse>(
    `/api/settings/ai-gateway?installation_id=${encodeURIComponent(installationId)}`,
  );
}


export async function postApi(
  path: string,
  body?: unknown,
  requestCookieHeader?: string,
): Promise<void> {
  await apiRequest(path, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  }, requestCookieHeader);
}


export async function postApiJson<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
}


export async function putApiJson<T>(
  path: string,
  body: unknown,
): Promise<T> {
  return apiRequest<T>(path, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}


export function buildLoginHref(nextPath: string): string {
  const url = new URL("/api/auth/github/login", getApiBaseUrl());
  url.searchParams.set("next_path", nextPath);
  return url.toString();
}


export function buildApiHref(path: string): string {
  return new URL(path, getApiBaseUrl()).toString();
}


export async function postLogout(): Promise<void> {
  await apiRequest("/api/auth/logout", {
    method: "POST",
  });
}


async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  requestCookieHeader?: string,
): Promise<T> {
  // Route handlers expose Next's mutable ResponseCookies adapter, which has no
  // `.size` and whose toString() uses Set-Cookie syntax. Serialize only request
  // name/value pairs through the API shared by both mutable and readonly stores.
  // Route handlers already own a NextRequest. An explicitly empty header means
  // unauthenticated; never substitute ambient request state in that case.
  const forwardedCookies = requestCookieHeader ?? (await cookies()).getAll()
    .map(({ name, value }) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
  const response = await fetch(new URL(path, getApiBaseUrl()), {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(forwardedCookies ? { Cookie: forwardedCookies } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new ApiRequestError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}


async function readErrorDetail(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { detail?: string };
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return payload.detail;
    }
  }

  return response.statusText || "NotebookLens API request failed";
}


const LOCAL_API_BASE_URL = "http://127.0.0.1:8000";


function getApiBaseUrl(): string {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim();
  if (!configuredBaseUrl) {
    if (allowsLocalApiFallback()) {
      return LOCAL_API_BASE_URL;
    }
    throw new ApiConfigurationError("APP_BASE_URL is required in production");
  }

  return normalizeAppBaseUrl(configuredBaseUrl);
}


function normalizeAppBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ApiConfigurationError("APP_BASE_URL must be an absolute http(s) origin");
  }

  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.host) {
    throw new ApiConfigurationError("APP_BASE_URL must be an absolute http(s) origin");
  }

  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new ApiConfigurationError(
      "APP_BASE_URL must be an origin without a path, query, or fragment",
    );
  }

  if (!allowsLocalApiFallback() && isLoopbackHost(parsed.hostname)) {
    throw new ApiConfigurationError(
      "APP_BASE_URL must be a public http(s) origin in production",
    );
  }

  return `${parsed.protocol}//${parsed.host}`;
}


function allowsLocalApiFallback(): boolean {
  return process.env.NODE_ENV !== "production";
}


function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1"
  );
}
