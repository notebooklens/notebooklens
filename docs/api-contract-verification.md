# API contract verification — 2026-09-14

This report inventories all 20 application method/path pairs from the actual
FastAPI OpenAPI schema and records observed HTTP responses during the full
isolated TestClient suite. Upstreams are mocked; this is not live GitHub/provider
acceptance or proof of every branch. Auto-generated API documentation routes are
not application endpoints and are excluded.

Command (instrumentation prints declared templates, never request data):

```sh
PYTHONPATH=scripts:. uv run --python 3.12 --no-project --with-editable '.[test]' pytest -q -o addopts= -p api_route_audit tests
```

Result: 254 passed on both Python 3.13 and Python 3.12 (the CI version), including
the instrumented inventory run. The normal suite reports one Starlette/AnyIO
deprecation warning.

| Method | Registered path | Observed statuses |
| --- | --- | --- |
| GET | `/healthz` | 200, 503 |
| GET | `/api/session` | 200, 401 |
| GET | `/api/repositories` | 200, 400, 401, 422, 502 |
| GET | `/api/github/install/callback` | 302 |
| POST | `/api/github/webhooks` | 202, 401 |
| GET | `/api/auth/github/login` | 302 |
| GET | `/api/auth/github/callback` | 302 |
| GET | `/api/auth/github/error` | 400 |
| POST | `/api/auth/logout` | 204 |
| GET | `/api/reviews/{owner}/{repo}/pulls/{pull_number}` | 200, 401, 403 |
| GET | `/api/reviews/{owner}/{repo}/pulls/{pull_number}/snapshots/{snapshot_index}` | 200, 401, 403 |
| POST | `/api/reviews/{review_id}/threads` | 201, 400, 401, 403 |
| POST | `/api/reviews/{review_id}/rebuild-latest` | 202, 401, 403 |
| POST | `/api/threads/{thread_id}/messages` | 201, 401, 403 |
| POST | `/api/threads/{thread_id}/resolve` | 200, 401, 403 |
| POST | `/api/threads/{thread_id}/reopen` | 200, 401, 403 |
| GET | `/api/review-assets/{asset_id}` | 200, 401, 403 |
| GET | `/api/settings/ai-gateway` | 200, 401, 403 |
| PUT | `/api/settings/ai-gateway` | 200, 401, 403 |
| POST | `/api/settings/ai-gateway/test` | 200, 401, 403 |

## Remaining coverage limits

All routes have at least one observed call, not exhaustive outcome coverage.
The inventory does not distinguish missing from expired authentication merely
because both return 401. Redirect status alone does not establish OAuth success.
Missing-resource 404 and upstream failures are not observed for review/snapshot,
thread, and asset routes. Thread reply/resolve/reopen malformed inputs and settings
validation/upstream errors need additional route-level cases before an exhaustive
API claim. Helper/worker unit tests cover additional branches but are not counted
as HTTP outcomes here. No real account permissions were changed.

## New contract checks

`apps/web/lib/fixtures/serialized_thread.json` is checked against the actual Python
`serialize_thread` output; Vitest feeds the same JSON through both latest and
historical workspace GETs. One API-boundary adapter maps nested `github_mirror`
to the existing component fields. Explicit nested null fields overwrite legacy
flat values. Component fixtures alone previously missed this shape mismatch.

New snapshots store optional `head_commit: {sha, subject}` in their existing JSON.
The worker makes at most one authenticated metadata request per cache miss;
only 20 recent ready snapshots in the same installation repository/SHA are
searched. Both successful and null results are cached. Workspace GET performs
no GitHub enrichment calls and does not mutate old rows. Legacy history has a
null subject. This requires no schema migration or history backfill.

GitHub interface verified against [Get a commit](https://docs.github.com/en/rest/commits/commits#get-a-commit):
`GET /repos/{owner}/{repo}/commits/{ref}`, existing installation Contents:read,
top-level `sha` and nested `commit.message`. Only the first line (at most 500
characters) is stored, not authors, commit bodies, or the rest of the response.
The SHA must match the requested snapshot head exactly. Existing request timeout
is 30 seconds. No pagination, automatic retry, or author-identity persistence is
introduced. Optional enrichment failure leaves notebook review functional.

Local resolution remains local; posting a notice does not resolve GitHub's native
conversation. Helper copy now describes this explicitly and does not promise
inbound reply synchronization.
