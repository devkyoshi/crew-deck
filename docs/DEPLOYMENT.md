# Deployment

The hosting target has not been chosen yet, so this describes what any host needs and gives a concrete
single-VM recipe with Docker Compose. Everything here was exercised against the compose stack
(empty database to a working API and web app); TLS, DNS and the reverse proxy are the parts that depend on your host.

## What runs

```
Browser ──https──▶ reverse proxy ──▶ web (Next.js :3000) ──/api──▶ api (Fastify :4000)
                                                                      ├─▶ Postgres 17
                                                                      └─▶ Redis 7
```

- **web** serves the UI and proxies `/api/*` to the API, passing the original `Host` header. That header
  is how the API knows which workspace a request belongs to.
- **api** is stateless. Sessions, the invite-email queue and the automatic check-out jobs live in Redis. The
  workers run inside the API process; running several API instances is safe (jobs are de-duplicated).
- **Postgres** holds all data. Row-level security enforces tenant isolation, so the API **must** connect
  as the restricted role (`crew_app`), never as the schema owner.
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
| `DATABASE_URL`                                           | `postgres://crew_app:<password>@postgres:5432/<db>` (restricted role)                        |
| `DATABASE_ADMIN_URL`                                     | Schema owner, used only by the one-off `migrate` service                                     |
| `REDIS_URL`                                              | `redis://redis:6379`                                                                         |
| `BASE_DOMAIN`                                            | `yourdomain.com`                                                                             |
| `WEB_ORIGIN`                                             | `https://yourdomain.com` (Google redirects here)                                             |
| `TENANT_ORIGIN_TEMPLATE`                                 | `https://{slug}.yourdomain.com`                                                              |
| `TRUST_PROXY`                                            | `true` when a reverse proxy sets `X-Forwarded-For`, so rate limits see real client addresses |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`               | From Google Cloud (see below)                                                                |
| `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | From Brevo (see below)                                                                       |
| `AUTH_RATE_LIMIT_MAX`                                    | Leave at the default (10)                                                                    |

Change every default password (`POSTGRES_PASSWORD`, `APP_ROLE_PASSWORD`). The `web` image bakes in
`API_INTERNAL_URL` at build time (`http://api:4000` in compose).

## First deploy (single VM)

```bash
git clone <repo> && cd crew-deck
cp .env.example .env            # then edit it: passwords, domain, Google, Brevo
docker compose --profile full up -d --build
```

`--profile full` starts Postgres, Redis, a one-off **migrate** service that applies the SQL migrations
(the API waits for it), the API and the web app. Check it:

```bash
docker compose ps                         # api shows "healthy"
curl -s localhost:4000/api/v1/health      # {"status":"ok","db":true}
```

**On every update:** `git pull && docker compose --profile full up -d --build`. Migrations run automatically
before the new API starts; running them twice is harmless. To undo the latest migration:
`docker compose run --rm --entrypoint node_modules/.bin/tsx migrate src/db/migrate.ts down`.

### The first workspace

Self-service workspace creation arrives with Phase 9. Until then, create the first workspace and its owner in SQL
(replace the values). The owner then signs in with Google using that email, or you can set a
password hash with the same method the seed script uses.

```sql
insert into organizations (name, slug, domain) values ('Acme Inc', 'acme', 'acme.com');
insert into users (email, name, status) values ('founder@acme.com', 'Founder', 'active');
insert into memberships (org_id, user_id, org_role)
  select o.id, u.id, 'owner' from organizations o, users u
  where o.slug = 'acme' and u.email = 'founder@acme.com';
```

Run it as the schema owner (`crew_admin`). `domain` is the email domain people must sign in with. The
development seed and its `dev-password-123` accounts are for local use only; do not run `--profile tools`
seeding in production.

### Reverse proxy and TLS

Anything that terminates TLS and forwards the original `Host` works. Caddy example, with a wildcard certificate via a DNS provider plugin:

```
*.yourdomain.com, yourdomain.com {
    tls { dns <provider> <token> }
    reverse_proxy localhost:3000
}
```

nginx needs `proxy_set_header Host $host;` and `X-Forwarded-For`/`X-Forwarded-Proto`, and `listen 443 ssl`
with the wildcard certificate. Publish only ports 80 and 443; bind the API (4000), Postgres and Redis to localhost or a private network.

## Google sign-in

1. Google Cloud Console, APIs and Services, Credentials, create an **OAuth client ID** (Web application).
2. Authorised redirect URI: `https://yourdomain.com/api/v1/auth/sso/google/callback` (exactly `WEB_ORIGIN` plus that path).
3. Put the client id and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, restart the API. The button appears on the sign-in page.

Only addresses on the workspace's own domain can sign in, and a person must already exist or have a pending invitation.

## Invitation email (Brevo)

1. Create a Brevo account and an API key (SMTP and API, v3).
2. Verify the sender address or domain you will send from. **Brevo rejects mail from unverified senders.**
3. Set `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` and restart the API.

Without a key the system still works: admins see each invite link and share it themselves.

## Operations

- **Backups.** Postgres is the system of record: `docker compose exec postgres pg_dump -U crew_admin crewdeck | gzip > backup.sql.gz`
  nightly, copied off the VM, and restore-tested. Redis does not need backing up.
- **Logs.** The API logs structured JSON to stdout (`docker compose logs api`). Authorization and cookie headers are redacted.
- **Health.** `GET /api/v1/health` checks the database. Compose uses it as the API health check.
- **Capacity.** Measured on one process with 5,000 people and 1,500 spaces in one workspace: list pages
  respond in tens of milliseconds, and 40 concurrent mixed requests complete in well under a second.
- **Security headers** are set by both apps (no sniffing, no framing, no caching of API responses, HSTS in production).
  A full script-source Content Security Policy needs per-request nonces and is not in place yet.

## Production checklist

- [ ] Wildcard DNS and wildcard TLS certificate working; `https://acme.yourdomain.com/sign-in` loads
- [ ] `NODE_ENV=production`, default passwords changed, `.env` not committed
- [ ] API, Postgres and Redis not reachable from the internet
- [ ] `TRUST_PROXY=true` behind the proxy
- [ ] Google redirect URI matches `WEB_ORIGIN`; Brevo sender verified
- [ ] First owner can sign in; an invitation email arrives and can be accepted
- [ ] Backup job running and a restore tested
- [ ] The dev seed was **not** run (no `@acme.test` accounts exist)
