const NOTEBOOKLENS_PUBLIC_ORIGIN = "https://notebooklens.local";


export function buildLoginHref(nextPath: string): string {
  const url = new URL("/api/auth/github/login", NOTEBOOKLENS_PUBLIC_ORIGIN);
  url.searchParams.set("next_path", nextPath);
  return `${url.pathname}?${url.searchParams.toString()}`;
}


export function buildApiHref(path: string): string {
  if (path.startsWith("/")) {
    return path;
  }
  return `/${path}`;
}
