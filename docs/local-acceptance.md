# Local acceptance deployment

This isolated pilot targets an operator-controlled test repository. It is not a production
deployment or evidence of ReviewNB parity. The bootstrap can prove local health;
real sign-in, webhooks and reviews require registering a GitHub App afterward.

Prerequisites: Docker with Compose 2.24.4+ and Python 3. A later external GitHub
test needs a reachable HTTPS tunnel, such as an operator-approved cloudflared
tunnel. No tunnel is started by the bootstrap.

## Prepare and start locally

Run from the repository root:

```bash
python3 deploy/prepare-local-acceptance.py
docker compose -p notebooklens-acceptance -f deploy/docker-compose.yml -f deploy/docker-compose.acceptance.yml --env-file deploy/.env.acceptance config --quiet
docker compose -p notebooklens-acceptance -f deploy/docker-compose.yml -f deploy/docker-compose.acceptance.yml --env-file deploy/.env.acceptance up --build -d
docker compose -p notebooklens-acceptance -f deploy/docker-compose.yml -f deploy/docker-compose.acceptance.yml --env-file deploy/.env.acceptance ps
curl --fail http://localhost:18080/api/healthz
```

The script creates random database/session/encryption/webhook secrets in a new
mode-0600 ignored file, refuses to overwrite it, and prints no secret values.
GitHub App/OAuth fields remain unmistakable placeholders from the example. Do
not expect GitHub login or the production review UI to work yet: production
frontend API calls require an HTTPS origin, so the default HTTP bootstrap is
**health-only**. If the approved tunnel origin is already known, create the env
with `python3 deploy/prepare-local-acceptance.py --public-origin https://YOUR-TUNNEL-HOST`
instead. This still refuses overwrite; otherwise edit `APP_BASE_URL` locally
after starting the tunnel. Do not paste this env file into chat, logs,
issues, or a PR. Use `config --quiet`: ordinary `config` prints resolved secrets.
Docker host administrators can still inspect container environment values; this
is a local pilot, not a secrets-manager integration. `.dockerignore` excludes
local env files and PEM/key files from image build contexts. Keep downloaded App
keys outside the checkout as well; Docker exclusion is not Git exclusion.

Only the gateway is published, on `127.0.0.1:18080`. The overlay **replaces** the
base port list, so host ports 80/443 are not exposed. API, database, web and Caddy
admin have no published ports; Caddy admin is disabled. A distinct Compose
project gives this pilot its own network and persistent database volume. Never
omit the overlay when using these bootstrap credentials.

The worker's notification batch size is forced to zero: notifications remain
pending without email provider requests. Do not enable email until recipients
and provider are approved. A fresh pilot database has no AI gateway configured,
so managed AI makes no provider calls. `MANAGED_AI_UI_ENABLED=false` is also set,
but this flag is not currently an enforced backend kill switch: do not configure
an AI gateway in settings or reuse a database containing one. GitHub traffic
after App setup is expected; this is not a network-isolated stack.

## Connect a test-organization GitHub App

An explicitly approved tunnel may forward HTTPS to `http://127.0.0.1:18080`.
For a temporary cloudflared test, the operator command is:

```bash
cloudflared tunnel --url http://127.0.0.1:18080
```

This makes the local app internet-reachable. Only run it when ready; its URL may
change on restart. Do not install on company repositories. Use the same HTTPS
origin for `APP_BASE_URL` and all GitHub configuration:

- Webhook: `<origin>/api/github/webhooks`
- OAuth callback: `<origin>/api/auth/github/callback`
- Setup URL: `<origin>/api/github/install/callback`

Register/install the App in your test organization, limited to a synthetic-data
repository such as `EXAMPLE_ORG/EXAMPLE_REPO` using **Only select repositories**, not all repositories.
Set these repository permissions for the current pilot:

| Permission | Access | Purpose |
| --- | --- | --- |
| Contents | Read-only | Read notebook files and revisions |
| Checks | Read and write | Publish the review workspace check |
| Issues | Read and write | Mirror discussion summaries to PR issue comments |
| Pull requests | Read and write | Read PR files and mirror native review comments |
| Metadata | Read-only | Repository identity and access (automatically included) |

No organization permissions, repository administration, Actions write, or
Contents write are needed. Subscribe to **Pull request** webhook events. Current
ingestion handles `opened`, `reopened`, and `synchronize` only; other actions and
comment/review events are ignored. Do not infer inbound discussion synchronization
from successful webhook delivery. Broader lifecycle support remains work to do.

Use the **same GitHub App's** client ID and generated client secret for
`GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`; a separate OAuth App is
not required. The GitHub App's user authorization uses the OAuth web flow, but
its user access token permissions come from the App and user access, not OAuth
scopes. See [GitHub's user-token setup](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).
The client ID differs from the numeric App ID used in `GITHUB_APP_ID`.

Enter those issued credentials and private key locally in the private env file;
configure the matching webhook secret in GitHub. Do not treat placeholder
credentials as a configured App. User-token refresh is not implemented yet:
re-authenticate after expiration during the pilot instead of disabling expiration.

Import a downloaded, unencrypted RSA App key without pasting it into a command
argument or converting its newlines manually:

```bash
uv run --no-project --with-editable '.[managed]' python deploy/configure-app-key.py /absolute/path/outside-checkout/app.private-key.pem
```

The importer requires existing regular files (no symlinks), validates RSA,
atomically updates only the signing-key env entry, and makes both key and env
mode 0600 without printing credentials. It uses a single-quoted multiline PEM
that both Docker Compose and python-dotenv read identically. It does not replace
the App ID, client credentials, or webhook secret, and does not restart services.

After changing the origin or credentials, rerun the exact `up --build -d`
command above to recreate services. Use the HTTPS origin for sign-in (secure
cookies), not the local HTTP health-check URL. Update all URLs if the tunnel
changes. App permission approval and live acceptance remain separate steps.

## Stop without deleting review data

```bash
docker compose -p notebooklens-acceptance -f deploy/docker-compose.yml -f deploy/docker-compose.acceptance.yml --env-file deploy/.env.acceptance stop
```

Stop the tunnel in its own terminal with Ctrl-C. Do not run `down -v`: that
would delete this pilot's persistent database. Local health does not establish
that GitHub callbacks, browser review workflows, or interactive outputs pass.

## Bootstrap evidence — 2026-09-13

The isolated five-service stack was started for a test-organization pilot. The
temporary HTTPS tunnel returned HTTP 200 for the homepage; API readiness
reported configuration and database checks OK. Database migration revision was
`20260413_0006`. Renderer responses included same-origin frame ancestry,
`nosniff`, and the expected static-asset CORS header.

An independent Chromium smoke test loaded the public homepage (title:
`NotebookLens Review Workspace`) and found the `Continue with GitHub` link at
`/api/auth/github/login?next_path=%2F`, with no browser console errors or uncaught
runtime errors during the load. It did **not** follow the OAuth link.
Independent inspection of the five containers' actual host port bindings found
only `127.0.0.1:18080` forwarding to gateway port 8080; web, API, worker, and
PostgreSQL had empty host port bindings. Image-declared `EXPOSE` ports shown by
Docker are not additional host listeners.

This is bootstrap evidence only. GitHub App credentials were still placeholders:
no live installation, OAuth sign-in, webhook-driven PR review, or authenticated
review acceptance has passed. The temporary tunnel URL is intentionally not
recorded here because it is ephemeral and is not a production deployment.

## Data-preserving pilot update — 2026-09-14

The web/API/worker were rebuilt together for the repository homepage, thread
action redirects, and saved Plotly HTML extraction. A private mode-0600 database
backup was restored into a disposable PostgreSQL database and successfully
upgraded from `20260413_0006` to `20260913_0007`. API/worker writes were then paused,
a fresh private cutover backup was taken, and the active database received the
same additive migration. Aggregate review/snapshot/thread counts were unchanged.
The temporary restore-check database was removed; the private backups remain
outside the checkout. No volumes were deleted.

The matching services restarted successfully. Local checks verified the new
homepage returns 200, API health returns 200, anonymous `/api/session` returns
401, and malformed pre-API thread submissions return a safe relative 303 or a
JSON 400. These probes create no comments. Stored snapshots are immutable:
backend Plotly extraction changes require a newly prepared snapshot, not just
a browser refresh. These deployment checks do not establish authenticated live
GitHub commenting or complete ReviewNB/Plotly parity.

## Backfill commit subjects on existing snapshots

Snapshots prepared before commit-subject enrichment have no `head_commit` field.
Refreshing the browser does not fetch missing titles. The operator module below
fills only this display metadata, without rebuilding notebook snapshots, posting
GitHub comments, configuring AI, or changing discussions/anchors. It uses the
existing installation's Contents:read authorization and exact stored head SHA.
It does not recover commits which GitHub can no longer serve.

First obtain approval for the exact review and inspect its UUID and repository/PR
identity read-only. The module requires **all four selectors to match**, an active
repository, and ready snapshots. Run it from a trusted API image with the current
operator configuration; do not paste environment values or keys into commands.
The existing Compose overlay remains mandatory. The API image must include
`apps/api/backfill_commit_subjects.py`; building an image does not require
restarting the running API or worker.

Default dry run makes no GitHub calls and no database writes. Replace the
synthetic selectors below with the approved review's identity:

```sh
docker compose -p notebooklens-acceptance -f deploy/docker-compose.yml -f deploy/docker-compose.acceptance.yml --env-file deploy/.env.acceptance run --rm --no-deps api python -m apps.api.backfill_commit_subjects --review-id 00000000-0000-0000-0000-000000000001 --owner example --repo notebooks --pull-number 1 --limit 20
```

Before `--apply`, create a fresh private PostgreSQL custom-format backup outside
the checkout using `pg_dump -Fc`, mode 0600, with a private parent directory.
Do not print dump contents or place it in an image build context. Validate the
archive and restore it into a newly created disposable database; compare the
schema revision and aggregate review/snapshot/thread counts. If validation fails,
stop. Do not drop or restore over the active database. Remove only the explicit
disposable validation database afterward; retain the private backup. This is a
data-preserving metadata operation, not a schema migration; a schema mismatch
must be investigated before any write.

After approving the backup validation, repeat the same explicit command with
`--apply`. Each invocation scans at most `--limit` ready snapshots (default 20,
maximum 50), in snapshot-index order, and makes at most one authenticated lookup
per distinct eligible SHA in that batch. A lookup uses the existing 30-second
request timeout; there is no automatic retry loop. Output contains aggregate
counts and a `next_after_snapshot_index`, never titles, notebook content, tokens,
or upstream error details. Use `--after-snapshot-index N` to continue a large
review. A non-empty final batch does not prove there are more rows; a subsequent
empty batch establishes completion of the scan.

Valid titles are never overwritten. Null/missing subjects are explicitly retried
even if an earlier build cached failure. A failed lookup leaves the original JSON
unchanged, and can be retried by rerunning the same batch/cursor; do not advance
past failures without noting them. Subjects are plain text, first line only,
bounded to 500 characters, and never inferred from a branch or PR title. Other
fields inside `head_commit`, all other snapshot JSON, and snapshot identity,
timestamps, source/output data, and discussions remain unchanged.

Updates use an optimistic compare-and-swap on the original snapshot JSON, head
SHA, ready status, and active repository. Concurrent changes are skipped and
reported as conflicts instead of overwritten. No row lock is held during GitHub
requests. Each invocation commits once after processing its bounded batch;
unexpected transaction errors roll back the batch. This is not a claim of
multi-worker load-test coverage. Verify aggregate counts before/after and reopen
the same saved snapshot in the UI; a successful count alone is not visual
acceptance. No service restart or notebook rebuild is required for the new
history labels to become readable.

### Subject backfill pilot evidence — 2026-09-14

An approved nine-snapshot pilot review contained nine legacy snapshots without
`head_commit` metadata. A private mode-0600 custom-format PostgreSQL backup was
restored into a new disposable database; schema revision and aggregate
review/snapshot/thread/message counts matched. The scoped operator batch fetched
all nine actual commit subjects and updated nine metadata entries, with no
unavailable results or conflicts. A subsequent dry run reported nine unchanged
snapshots and no eligible updates or GitHub lookups.

Before/after one-way hashes of snapshot rows and payloads excluding `head_commit`,
and all discussion/message rows, matched exactly. The nine snapshots, one thread,
two messages, and schema revision `20260913_0007` were preserved. No snapshot
rebuild, GitHub comment, AI request, or permission change was performed. The
temporary validation database and copied operator module were removed; the
private backup remains outside the checkout. These are data-integrity and real
commit-lookup checks, not a claim of full browser or ReviewNB acceptance.
