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
