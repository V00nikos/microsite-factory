# Deploy the Hermes harness to Railway (Task 3.5)

Lifts the factory Hermes gateway off the Mac onto Railway so the frontend gets a
**stable public webhook base URL** (retires the tunnel). Microsites still deploy
to Cloudflare Pages; only Hermes moves here.

**Rule:** we never fork Hermes core source. Railway builds Hermes' *own* Dockerfile
from `~/.hermes/hermes-agent`; the factory's profiles/skills/creds and the
`microsite-factory` repo are **seeded onto the volume** (`seed-volume.sh`), not baked
into the image. One Railway service = one Hermes profile.

## Prerequisites (you — interactive)

```bash
railway login                 # opens browser; interactive, must be run by a human
```

## Steps

1. **Init a project + service** (from anywhere):
   ```bash
   railway init                      # create/choose a project
   railway service create hermes-factory-worker
   ```
2. **Create + attach the volume** at `/opt/data` (dashboard → service → Variables/Volumes,
   or CLI). Name it `hermes-data`, mount path **`/opt/data`** (matches `HERMES_HOME`).
3. **Set env vars** on the service (dashboard or `railway variables set K=V`) — never in the image:
   `HERMES_UID=10000`, `HERMES_GID=10000`, `OPENAI_API_KEY`, `LINKUP_API_KEY`,
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CONVEX_SITE_URL`, `FACTORY_KEY`,
   `WEBHOOK_HMAC_SECRET` (and `ANTHROPIC_API_KEY` if/when you switch providers).
4. **Deploy** — build Hermes' official Dockerfile from its source dir, applying this config:
   ```bash
   cd ~/.hermes/hermes-agent
   railway up --service hermes-factory-worker --config ~/microsite-factory/deploy/railway/railway.toml
   ```
   (`railway.toml` sets the Dockerfile build, the `/opt/data` volume, and `startCommand = gateway run`.)
5. **Seed the volume** with the factory profiles + skills + creds + repo, then verify:
   ```bash
   ~/microsite-factory/deploy/railway/seed-volume.sh hermes-factory-worker
   railway redeploy --service hermes-factory-worker
   ```
   The seed lands the repo at `/opt/data/microsite-factory` so the skills'
   `~/microsite-factory/scripts/*` paths resolve (in-container `HOME=/opt/data`), and
   the seeded `config.yaml` carries the `command_allowlist` so the pipeline runs unattended.
6. **Wire the frontend**: copy the service's public URL and set it as the Pages Function
   env `HERMES_WEBHOOK_BASE` (see `../../frontend/.dev.vars.example`). Then subscribe the
   three webhooks (`docs/webhook-setup.md`) against that base.

## Verify

```bash
railway ssh --service hermes-factory-worker -- hermes doctor
railway ssh --service hermes-factory-worker -- hermes skills list
```
Then re-run the Task 3 test account end-to-end against the Railway instance and confirm
a fleet row + traces land in Convex.

## Notes / gotchas

- The published image seals `/opt/hermes` read-only; **all** writable state (auth.json,
  .env, config.yaml, profiles, skills, memory, traces, lazy-installed packages) lives on
  the `/opt/data` volume — that's why the volume mount path must be exactly `/opt/data`.
- Playwright browsers are baked at `/opt/hermes/.playwright` (survives the volume overlay),
  so the qa-reviewer's screenshots work in-container.
- Skill edits still happen in the repo → re-run `install-skills.sh` inside the container
  (the seed script does this) or re-seed; never hot-edit `/opt/data/skills` by hand.
