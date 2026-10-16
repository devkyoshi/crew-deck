# Deployment

The hosting target has not been chosen yet, so this describes what any host needs and gives a concrete
single-VM recipe with Docker Compose. Everything here was exercised against the compose stack
(empty database to a working API and web app); TLS, DNS and the reverse proxy are the parts that depend on your host.

## What runs

```
Browser ──https──▶ reverse proxy ──▶ web (Next.js :3000) ──/api──▶ api (Fastify :4000)
                          │                                           ├─▶ MongoDB 7 (replica set)
                          │                                           └─▶ Redis 7
                          └──/realtime──▶ realtime gateway (Socket.IO :4100) ─▶ MongoDB, Redis
```

- **web** serves the UI and proxies `/api/*` to the API, passing the original `Host` header. That header
  is how the API knows which workspace a request belongs to.
- **api** is stateless. Sessions, the invite-email queue and the automatic check-out jobs live in Redis. The
  workers run inside the API process; running several API instances is safe (jobs are de-duplicated).
- **realtime** is the Messages gateway (Socket.IO over WebSocket). It is stateless: rooms live in Redis through
  the Socket.IO Redis adapter, so several instances behind a load balancer work with **no sticky sessions**
  (clients use WebSocket only). It reads the same session cookie as the API, resolving the workspace from the
  `Host` / `X-Forwarded-Host` header, and runs the same messaging services and permission checks as the API.
- **MongoDB** holds all data. It must run as a **replica set** (a single node is fine), because the API
  uses multi-document transactions. Tenant isolation is enforced by the API's repository layer (every
  query carries the workspace id), so give the API a database user limited to its own database.
- **Redis** holds sessions and queued jobs. Losing it signs everyone out and drops unsent emails, but loses no business data.

Keep the API on a private network. Only the reverse proxy should be public.

## Requirements

- A Linux VM with Docker and Compose, about 2 GB RAM for a small team.
- A domain you control, with a **wildcard DNS record**: `*.yourdomain.com` to the VM (plus `yourdomain.com`
  if you want the workspace picker). Each workspace is `<slug>.yourdomain.com`.
- A **wildcard TLS certificate** for `*.yourdomain.com`. Session cookies are `Secure`, so the app does not
  work over plain http outside `localhost`. Wildcard certificates need a DNS challenge (Caddy and certbot both support it).

## Configuration

Set these for the `api` service (compose reads them from the environment or a `.env` file):

| Variable                                                 | Production value                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                               | `production` (set by the image). Disables the dev-only login, makes cookies `Secure`         |
| `MONGODB_URI`                                            | `mongodb://<user>:<password>@mongo:27017/?replicaSet=rs0` (or `directConnection=true` for one node) |
| `MONGODB_DB`                                             | Database name, for example `crewdeck`                                                         |
| `REDIS_URL`                                              | `redis://redis:6379`                                                                         |
| `BASE_DOMAIN`                                            | `yourdomain.com`                                                                             |
| `WEB_ORIGIN`                                             | `https://yourdomain.com` (Google redirects here)                                             |
| `TENANT_ORIGIN_TEMPLATE`                                 | `https://{slug}.yourdomain.com`                                                              |
| `TRUST_PROXY`                                            | `true` when a reverse proxy sets `X-Forwarded-For`, so rate limits see real client addresses |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`               | From Google Cloud (see below)                                                                |
| `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | From Brevo (see below)                                                                       |
| `AUTH_RATE_LIMIT_MAX`                                    | Leave at the default (10)                                                                    |
| `STORAGE_DRIVER`, `STORAGE_DIR`                          | `local` and `/data/files` (set in compose; the `files` volume is mounted there)               |
| `STORAGE_SIGNING_SECRET`                                 | Required. 32+ random characters (`openssl rand -base64 48`); signs file links. The API refuses to start without it |

Turn on MongoDB authentication and give the API its own user (the dev compose file runs without auth). The `web` image bakes in
`API_INTERNAL_URL` at build time (`http://api:4000` in compose).

## First deploy (single VM)

```bash
git clone <repo> && cd crew-deck
cp .env.example .env            # then edit it: passwords, domain, Google, Brevo
docker compose --profile full up -d --build
```

`--profile full` starts MongoDB, Redis, a one-off **migrate** service that creates the indexes and the
plan catalogue (the API waits for it), the API and the web app. Check it:

```bash
docker compose ps                         # api shows "healthy"
curl -s localhost:4000/api/v1/health      # {"status":"ok","db":true}
```

**On every update:** `git pull && docker compose --profile full up -d --build`. Index creation runs
automatically before the new API starts (and again at API startup); running it twice is harmless. There are
no schema migrations to roll back: documents carry their own fields, and new fields get defaults in code.

### The first platform admin and the first workspace

Workspaces are created through the product: people sign up at `https://yourdomain.com/signup` (the bare
domain), or a platform admin creates one at `https://yourdomain.com/platform`. Platform admins are separate
from workspace accounts. Create the first one on the server, as the schema owner (the password is read from the
environment and never printed):

```bash
PLATFORM_ADMIN_EMAIL=you@yourcompany.com PLATFORM_ADMIN_PASSWORD='a long passphrase' \
  MONGODB_URI=... pnpm --filter @crew-deck/api db:platform-admin
```

Then sign in at `/platform/sign-in`. From the console you can create workspaces (the owner is emailed an
invitation), change plans, suspend, and change sign-up rules (open or closed sign-ups, blocking free email
providers, trial length). The development seed and its `dev@1234` accounts, including the dev platform
admin `platform@crewdeck.test`, are for local use only; do not run `--profile tools` seeding in production.

The bare domain must serve the web app (`/pricing`, `/signup`, `/platform`) as well as the wildcard
`*.yourdomain.com` tenants. Sign-up and the console only work on the bare domain; on a workspace address they
return 404.

### Reverse proxy and TLS

Anything that terminates TLS and forwards the original `Host` works. Caddy example, with a wildcard certificate via a DNS provider plugin:

```
*.yourdomain.com, yourdomain.com {
    tls { dns <provider> <token> }
    reverse_proxy localhost:3000
}
```

Route `/realtime/` to the gateway (port 4100) and keep WebSocket upgrades working. Caddy:

```
*.yourdomain.com, yourdomain.com {
    tls { dns <provider> <token> }
    handle /realtime/* { reverse_proxy localhost:4100 }
    handle { reverse_proxy localhost:3000 }
}
```

nginx needs `proxy_set_header Host $host;` and `X-Forwarded-For`/`X-Forwarded-Proto`, and `listen 443 ssl`
with the wildcard certificate. Publish only ports 80 and 443; bind the API (4000), MongoDB and Redis to localhost or a private network.

## Google sign-in

1. Google Cloud Console, APIs and Services, Credentials, create an **OAuth client ID** (Web application).
2. Authorised redirect URI: `https://yourdomain.com/api/v1/auth/sso/google/callback` (exactly `WEB_ORIGIN` plus that path).
3. Put the client id and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, restart the API. The button appears on the sign-in page.

Only addresses on the workspace's own domain can sign in, and a person must already exist or have a pending invitation.

## Invitation email (Brevo)

1. Create a Brevo account and an API key (SMTP and API, v3).
2. Verify the sender address or domain you will send from. **Brevo rejects mail from unverified senders.**
3. Set `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` and restart the API.

Sign-up verification emails go through the same sender. Without a key the system still works: admins see each
invite link and share it themselves, and the sign-up page shows the verification link on screen (never in
production). If Brevo rejects a message the sign-up page says so instead of pretending it was sent.

## Operations

- **Backups.** MongoDB is the system of record: `docker compose exec mongo mongodump --archive --gzip --db crewdeck > backup.archive.gz`
  nightly, copied off the VM, and restore-tested (`mongorestore --archive --gzip`). Redis does not need backing up.
  Attachments live in the `files` volume (`/data/files` in the API container): back it up with the database,
  for example `docker run --rm -v crew-deck_files:/f -v $PWD:/b alpine tar czf /b/files.tgz -C /f .`
- **Logs.** The API logs structured JSON to stdout (`docker compose logs api`). Authorization and cookie headers are redacted.
- **Health.** `GET /api/v1/health` checks the database. Compose uses it as the API health check.
- **Capacity.** Measured on one process with 5,000 people and 1,500 spaces in one workspace: list pages
  respond in tens of milliseconds, and 40 concurrent mixed requests complete in well under a second.
- **Live updates** use server-sent events at `/api/v1/spaces/:id/events`. A reverse proxy in front must not
  buffer them: the API sends `X-Accel-Buffering: no` (nginx honours it); otherwise set `proxy_buffering off`
  and a read timeout above 60 seconds for that path. Every API instance must reach the same Redis
  (pub/sub carries the messages between instances).
- **Background jobs** run in the API process: notification emails every minute, due-date reminders and
  sprint snapshots every hour, rank rebalancing on demand.
- **Security headers** are set by both apps (no sniffing, no framing, no caching of API responses, HSTS in production).
  A full script-source Content Security Policy needs per-request nonces and is not in place yet.

## Production checklist

- [ ] Wildcard DNS and wildcard TLS certificate working; `https://acme.yourdomain.com/sign-in` loads
- [ ] `NODE_ENV=production`, default passwords changed, `.env` not committed
- [ ] API, MongoDB and Redis not reachable from the internet
- [ ] `TRUST_PROXY=true` behind the proxy
- [ ] Google redirect URI matches `WEB_ORIGIN`; Brevo sender verified
- [ ] A platform admin exists and can sign in at `/platform/sign-in`; a test sign-up on the bare domain arrives by email and creates a workspace
- [ ] First owner can sign in; an invitation email arrives and can be accepted
- [ ] `STORAGE_SIGNING_SECRET` set; an attachment uploads and opens in the browser
- [ ] Backup job running (database and the `files` volume) and a restore tested
- [ ] The dev seed was **not** run (no `@acme.test` accounts exist)
