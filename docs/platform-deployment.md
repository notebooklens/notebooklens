# Platform-managed deployment integration

This guide maps NotebookLens's existing container contract to an application
platform that offers OAM-style application definitions, managed PostgreSQL,
service workloads, secret references, and ingress. It is a requirements and
integration checklist, **not a validated platform installer**. No private
platform manifest, component schema, infrastructure name, or credential is
included here. Docker Compose remains the documented pilot deployment path.

A platform's service and database component types, schema versions, resource
units, secret bindings, command overrides, and migration-job facilities must be
verified by its operators before generating a runnable manifest. Similar-looking
application YAML is not evidence that these features behave identically.

## Map workloads, not just the API port

| Existing Compose service | Platform responsibility | Current container contract |
| --- | --- | --- |
| `web` | HTTP service for the reviewer UI | Build `apps/web/Dockerfile`; working directory `/app/apps/web`; production Next.js server on port `3000`. Requires `APP_BASE_URL`. |
| `api` | HTTP service for authentication, webhooks, reviews, assets, and settings | Build `apps/api/Dockerfile`; working directory `/app`; FastAPI on port `8000`. Database and secret configuration are required. |
| `worker` | Background workload without public ingress | Reuse the API image with command `run-managed-service worker`; processes snapshot, GitHub mirror, and notification queues. It is not an HTTP service. |
| `postgres` | Managed PostgreSQL instance and database | Replace the Compose database container with a platform database binding. Compose currently uses PostgreSQL 16; validate the selected managed engine/version and connection policy. |
| `gateway` | Single-origin TLS termination and path routing | Either retain an appropriately configured gateway or implement the same routes in platform ingress. Do not publish the API and UI under unrelated browser origins. |

Publish immutable, matching release images for web, API, and worker. Use the
platform's image repository/tag or digest fields and working-directory controls
without assuming that they override the container command automatically.

**Important:** the API Dockerfile's default command starts Uvicorn directly; it
does not migrate the database. Compose explicitly supplies
`run-managed-service api`, which runs Alembic before starting the API. A platform
deployment must choose a migration strategy explicitly, not merely copy port
`8000` and enable readiness.

The worker needs its own workload. Do not route traffic to it, assign the API's
HTTP readiness probe to it, or assume a successfully started web/API pair also
processes queued reviews.

## One public HTTPS origin

Set one stable HTTPS `APP_BASE_URL` for every workload. The deployment must route:

| Incoming path | Destination | Rewrite rule |
| --- | --- | --- |
| `/api/*` and `/api` | API port `8000` | Preserve the `/api` prefix for normal API routes. |
| `/api/healthz`, if exposed | API port `8000` | Rewrite this exact path to `/healthz`. |
| All other paths, including `/actions/*`, `/reviews/*`, and `/_next/*` | Web port `3000` | Preserve the path. Thread form actions belong to Next.js, not FastAPI. |

The direct API health route is `/healthz`, not `/api/healthz`. The local acceptance
gateway implements the exact health rewrite; the base Compose Caddyfile does
not. Treat the application route implementation and the chosen gateway rules as
the contract when configuring platform probes.

Configure the GitHub App against that same public origin:

- Webhook: `/api/github/webhooks`
- User OAuth callback: `/api/auth/github/callback`
- App setup callback: `/api/github/install/callback`

Ingress must preserve POST bodies and the GitHub signature headers. Do not put
an interactive browser login challenge in front of GitHub webhook delivery.
Keep application-level signature verification enabled. Preserve forwarded host
and scheme information, HTTPS secure cookies, and the renderer's CSP/sandbox
and asset headers. The server-rendered web application must also be able to
reach its configured API origin; validate DNS, TLS trust, and network policy from
inside the web workload, not only from an operator's laptop.

## Database binding and secret references

Use platform-managed secrets for sensitive values. A database password secret
reference alone is insufficient: the API and worker need a complete
`DATABASE_URL` containing the correct driver, host, port, database, user, and
TLS options. Verify how the platform injects or composes this connection string,
including escaping and certificate trust. Do not invent a secret-reference YAML
syntax without the platform's schema documentation.

| Configuration group | Placement and handling |
| --- | --- |
| `DATABASE_URL` | API and worker; platform-managed database credentials and required TLS policy. Do not bake it into an image. |
| `SESSION_SECRET`, `ENCRYPTION_KEY` | Stable secrets shared by API and worker instances. Losing them can invalidate sessions or make stored encrypted credentials unreadable. |
| `GITHUB_APP_PRIVATE_KEY`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET` | Separate secrets for App signing, user login, and webhook verification. Preserve PEM newlines. A mounted file is not automatically read by the current environment-based configuration. |
| App/client identifiers and GitHub host settings | API and worker configuration; validate actual GitHub.com or enterprise-host connectivity and support, rather than assuming that setting environment names proves it. |
| Email credentials and sender settings | Configure only for an approved provider/recipient scope. A healthy workload is not permission to send email. |
| `APP_BASE_URL`, feature flags, retention and output limits | Explicit non-secret runtime configuration; maintain consistent values across the release. See `deploy/.env.example` for the current inventory. |

The current implementation persists managed state, sessions, queued jobs,
discussion history, and review assets in the database. Include those assets in
capacity and backup planning; a generic environment setting must not be treated
as proof of an implemented external object-storage driver.

Do not print resolved secret references, environment dumps, database URLs, or
PEM contents in deployment logs. Keep notebook outputs and discussion text out
of routine request/error logs. Enable managed AI or notifications only after
separate configuration and authorization; UI feature flags are not a reliable
network-level kill switch. Use network policy where isolation is required.

## Readiness, resources, and scaling

- API readiness: probe the private service's `/healthz` on port `8000`. It checks
  configuration and database connectivity, **not** migration compatibility,
  GitHub authentication, or successful comment submission.
- Web readiness: the current Compose probe requests `/` on port `3000`. Add a
  separate integration check for authenticated review loading; HTML delivery
  alone does not prove the API can be reached.
- Worker readiness: no dedicated HTTP readiness endpoint currently exists. Use
  a platform-supported non-HTTP workload and verify queue progress. A durable
  heartbeat/queue-age monitor is an integration requirement, not an existing
  feature claimed by this document.
- Migrations: allow startup/release time for database availability and migration
  completion. A platform's generic `readiness enabled` toggle must be resolved
  to the actual path, port, timeout, and failure policy.
- Resources: size each workload independently from measured notebook sizes,
  rendering payloads, and queue pressure. Do not copy a reference application's
  CPU/memory numbers or assume their units are portable.
- Begin with a controlled single API/worker pilot. Before enabling multi-replica
  workers, rolling overlap, autoscaling, or availability-zone spreading, test
  queue claiming, duplicate deliveries, migration serialization, database
  connection limits, and worker interruption/recovery on the target platform.
  An autoscaling field in a manifest does not establish application HA readiness.

## Release and recovery gates

1. Record the current running image versions and database revision. Review the
   new migration and backfill behavior against representative existing data.
2. Take a private database backup and validate it can be restored in an isolated
   environment. Preserve the encryption/session secret versions needed to use
   the restored data, with separate restricted access controls.
3. Coordinate API and worker writes for migrations that are not proven compatible
   with old and new binaries simultaneously. Do not run competing migration
   entrypoints across replicas. Prefer a serialized platform release job when
   that facility is supported and verified.
4. Execute `alembic -c apps/api/alembic.ini upgrade head` from `/app` in the API
   release image with the intended database binding. Verify the resulting
   revision explicitly before starting dependent application workloads.
5. Start matching API and worker releases, then the web release. If retaining
   `run-managed-service api`, account for its migration step and serialize API
   startup; the worker entrypoint itself does not migrate.
6. Check service readiness, then exercise authenticated review loading and
   create/reply/resolve/reopen against approved synthetic data. Confirm queue
   progress and GitHub check behavior separately. Health alone does not pass
   this release gate.
7. Document the rollback decision. Reverting only the container image is unsafe
   after an incompatible schema change. Prefer a forward fix when possible;
   restore a validated backup only through an authorized recovery procedure
   that accounts for writes since the backup. Never use destructive database
   downgrade or volume deletion as routine rollout repair.

## Evidence needed before claiming platform support

The operator and application team still need to validate: component schemas and
secret bindings; worker and release-job support; image promotion; database TLS,
backup/restore, and schema upgrade; ingress paths and secure sign-in; signed
webhook ingestion and queue completion; interactive notebook output isolation;
discussion persistence and permissions; rollback and operational ownership.

Repository tests and image builds provide implementation evidence but do not
prove any private platform deployment. No platform deployment or provider call
was performed to produce this guide.

See also [self-hosting](self-hosting.md) and [local acceptance](local-acceptance.md).
