# DISMODO — production deployment

Step-by-step deployment of DISMODO on one Ubuntu 24.04 VPS (the reference
size is 4 CPU / 8 GB RAM) behind one public domain.

The stack is four containers, defined in `deploy/docker-compose.prod.yml`:

| Service | Image                              | Reachable from                |
| ------- | ---------------------------------- | ----------------------------- |
| `caddy` | `caddy:2-alpine`                   | Internet, ports 80/443        |
| `api`   | built from `deploy/Dockerfile`     | Only through Caddy            |
| `mcp`   | built from `deploy/Dockerfile.mcp` | Only through Caddy, at `/mcp` |
| `db`    | `postgres:17-alpine`               | Only `api` (never published)  |

Caddy terminates TLS (automatic HTTPS via Let's Encrypt) and proxies
`/mcp` to the MCP server and everything else to the API. The API serves
the built web app, the docs and the learner session pages itself, runs
the database migrations on startup, and is the only service that talks
to Postgres.

> Honest status: these files were written and checked by reading the
> codebase, but they have **not** been run on a real VPS, and Docker was
> not available in the environment that produced them (the image builds
> in "Verify before finishing" could not be executed there). Treat the
> first deployment as a test run: follow the steps, check the logs, and
> expect to fix small things. See "Open questions" at the bottom.

## 1. Prepare the VPS

Create an Ubuntu 24.04 VPS (4 CPU / 8 GB RAM is comfortable). Log in as a
user with `sudo`, then install Docker from Docker's own repository
(following https://docs.docker.com/engine/install/ubuntu/):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"   # log out and back in afterwards
docker run hello-world            # sanity check
```

Optional but recommended firewall (SSH plus HTTP/HTTPS only):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 2. Point DNS at the VPS

At your DNS provider, create records for your domain (example below uses
`dismodo.example.com`):

- `A` record: `dismodo.example.com` → the VPS IPv4 address.
- `AAAA` record (only if the VPS has IPv6): → the VPS IPv6 address.

Wait until `dig +short dismodo.example.com` returns the VPS address.
Caddy can only get a certificate once DNS resolves to this machine and
ports 80/443 are reachable from the internet.

## 3. Get the code and configure the environment

```bash
git clone <your DISMODO repository URL> /opt/dismodo
cd /opt/dismodo
cp deploy/.env.production.example deploy/.env
```

Edit `deploy/.env`. At minimum:

- `DISMODO_DOMAIN` — your domain, e.g. `dismodo.example.com` (no scheme,
  no trailing slash).
- `POSTGRES_PASSWORD` — generate one: `openssl rand -hex 24`. Use the
  same value inside `DATABASE_URL` in the same file.
- `META_API_KEY` — your Meta Model API key, if you want the adaptive
  (model-proposed) route. Without it, sessions still work on the
  reviewed editorial route and `/health` reports no decision models.

Everything else has working defaults. Notes:

- `PUBLIC_BASE_URL` in the example is `https://${DISMODO_DOMAIN}`;
  Compose sets the real value for the API container from
  `DISMODO_DOMAIN`, so you do not need to expand it by hand.
- Decision-model variables (`DECISION_ROUTINE_*`, `DECISION_CRITICAL_*`)
  mirror `.env.example` at the repository root.
- Never commit `deploy/.env`. It contains real secrets.

## 4. Build and start

From the repository root (`/opt/dismodo`):

```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
docker compose -f deploy/docker-compose.prod.yml ps
```

The first build takes a few minutes (pnpm install plus the web build).
On startup the API runs the database migrations automatically, so there
is no separate migration step. Then check:

```bash
curl -fsS https://dismodo.example.com/health
# {"status":"ok","engine_version":"...","database":"ok","decision_models":[...]}
curl -I https://dismodo.example.com/        # the web app
curl -fsS https://dismodo.example.com/llms.txt | head
```

If `/health` fails, read the logs (section 8) — the usual causes are a
wrong `DATABASE_URL` password, DNS not yet pointing at the VPS (Caddy
cannot get a certificate), or port 80/443 blocked by a cloud firewall.

## 5. Seed the reference experience

Seeding publishes the reference package in `experiences/` so learners
and agents have something to practise. Run it inside the API container
(migrations run first, and seeding is safe to repeat — already-present
packages are reported, not duplicated). The image does not ship a full
pnpm workspace, so call the script with `tsx` directly:

```bash
docker compose -f deploy/docker-compose.prod.yml exec api node_modules/.bin/tsx apps/api/scripts/seed.ts
```

## 6. Create a tenant and an API key

Tenants are products that call the API; each gets its own API key
(format `dsm_...`). The key is printed **once** — store it in your
password manager immediately:

```bash
docker compose -f deploy/docker-compose.prod.yml exec api \
  node_modules/.bin/tsx apps/api/scripts/create-tenant.ts --slug acme --name "Acme Training"
```

(`--label` names the key and `--scopes a,b` can restrict it; see
`apps/api/scripts/create-tenant.ts`.)

Quick check with the new key:

```bash
curl -fsS https://dismodo.example.com/v1/components \
  -H "Authorization: Bearer dsm_..."
```

MCP clients use the same key: point them at
`https://dismodo.example.com/mcp` with header
`Authorization: Bearer dsm_...`. The MCP endpoint only accepts `POST`
(Streamable HTTP), so a browser visit showing an error is expected.

## 7. Backups

`deploy/backup.sh` runs `pg_dump` inside the `db` container and writes a
gzipped dump to `deploy/backups/`, keeping the newest 14 files. Run it
once by hand first:

```bash
chmod +x deploy/backup.sh
./deploy/backup.sh
ls -lh deploy/backups/
```

Then schedule it with cron. `crontab -e` and add (adjust the path):

```cron
15 3 * * * cd /opt/dismodo && ./deploy/backup.sh >> deploy/backups/backup.log 2>&1
```

The restore command is documented at the top of `deploy/backup.sh`.
Backups live on the same VPS as the database: copy them elsewhere
regularly (for example `rsync` to another machine or object storage),
or a lost VPS takes the backups with it.

## 8. Day-to-day operations

Logs (follow mode; `Ctrl-C` stops following, containers keep running):

```bash
docker compose -f deploy/docker-compose.prod.yml logs -f api
docker compose -f deploy/docker-compose.prod.yml logs -f caddy mcp db
```

Updating to a new version:

```bash
cd /opt/dismodo
git pull
docker compose -f deploy/docker-compose.prod.yml up -d --build
docker compose -f deploy/docker-compose.prod.yml ps   # api should turn healthy
curl -fsS https://dismodo.example.com/health
```

Migrations run automatically when the API starts. There is no automatic
rollback: if a release is bad, check out the previous commit and run the
same `up -d --build` — but note that a migration applied by the newer
version stays applied, so restore from backup if the schema changed in
a way the older code cannot read.

Stopping everything (data in the named volumes is kept):

```bash
docker compose -f deploy/docker-compose.prod.yml down
```

## Open questions

Things that could not be settled from the code alone, or that may need
an application change (none was made, per the task rules):

- **Tested locally, not yet on the VPS.** On 2026-10-30 both images were
  built and the full stack ran with `DISMODO_DOMAIN=localhost` (Caddy's
  local certificate): health, landing, docs, `llms.txt`, the embed script
  with CORS, a playground session, MCP authentication, the seed and
  tenant commands above, and `backup.sh` all worked. A public ACME
  certificate needs real DNS and has not been exercised yet.
- **MCP behind the proxy.** The MCP server rejects any `Host` header not
  in `MCP_ALLOWED_HOSTS`. Compose sets that to your `DISMODO_DOMAIN`
  (plus internal names), assuming Caddy forwards the public domain as
  the `Host` header, which is Caddy's default. If MCP calls return
  `421 host_not_allowed`, check what Host Caddy actually sends
  (`docker compose ... logs mcp`) and adjust `MCP_ALLOWED_HOSTS` —
  no code change needed, but this exact path is untested.
- **MCP has no `/health` route** (`apps/mcp/src/http.ts` answers only
  `POST /mcp`), so its Docker healthcheck is a bare TCP connect. A real
  health endpoint would need a code change.
- **`/health` conflates API and database.** The API returns `503` when
  Postgres is unreachable, so the API container shows "unhealthy"
  during a database outage even though the process is fine. Splitting
  liveness from readiness would need a code change.
- **Certificate on first boot.** If DNS or ports 80/443 are not ready
  when Caddy first starts, certificate issuance fails and Caddy retries
  with backoff; fixing DNS and waiting (or restarting the `caddy`
  service) should recover without manual steps, but this was not
  exercised.
- **Single point of failure.** One VPS runs everything, including the
  backups directory. Off-site backup copies (section 7) and a restore
  rehearsal are on you.
- **Rate limiting** is per-route inside the API only; Caddy adds none.
  If the public playground is abused, add limits at the Caddy layer or
  in the API — neither is configured here.
