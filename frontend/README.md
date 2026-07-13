# Microsite Factory — Operator Console

Vite + React + TypeScript SPA. Reads **all** fleet state directly from Convex live
queries; sends commands to Hermes **only** through HMAC-signing Cloudflare Pages
Functions. Deployed (later) to Cloudflare Pages. Do not deploy from here.

## Screens

| # | Route | Screen |
|---|-------|--------|
| 1 | `/` | **Fleet Board** (centerpiece) — live Convex board: per-account stage/status, cost, live URL, beacon counts, blocked reasons **verbatim**, and the first-pass QA rate gauge. Live-updates + flashes on change. |
| 2 | `/intake` | **Intake** — CSV upload/paste, client-side validate + dedupe (domain+contact_title), >25 rows → cost-confirm, POST to `/api/run-factory`. |
| 3 | `/preview/:accountId` | **Preview + Edit** — site iframe, angle log (angle · because_findings · objection), Approve / Regenerate angle / Regenerate with instruction → `/api/regenerate`. `/preview` is a picker. |
| 4 | `/brief` | **GTM Planner** ("brief your agency") — positioning-memory editor → `/api/update-positioning`. |

## Commands

```bash
npm install
npm run dev          # Vite dev server (SPA only — /api/* Functions are NOT served)
npm run dev:pages    # wrangler pages dev — serves SPA + Functions together (full E2E)
npm run build        # tsc --noEmit && vite build  -> dist/   (this is what must pass)
npm run typecheck            # app types
npm run typecheck:functions  # Cloudflare Functions types
```

`npm run build` passes. To preview the board without a backend:
`VITE_DEMO_MODE=true npm run dev`.

## Environment variables — which side owns each

**Client build (Vite, `.env` / `.env.local`)** — see `.env.example`. Public; never a secret.
- `VITE_CONVEX_URL` — Convex deployment URL the board reads live from.
- `VITE_DEMO_MODE` — optional `"true"` runs a simulated fleet (design/rehearsal only).

**Pages Functions (server-only, `.dev.vars` locally / Pages project env in prod)** — see `.dev.vars.example`.
- `WEBHOOK_HMAC_SECRET` — HMAC key. **NEVER** a `VITE_` var, never in client code.
- `HERMES_WEBHOOK_BASE` — routes appended by name (`/run-factory`, `/regenerate`, `/update-positioning`).
- `HERMES_RUN_FACTORY_URL` / `HERMES_REGENERATE_URL` / `HERMES_UPDATE_POSITIONING_URL` — optional per-webhook overrides.

## Pages Functions (`functions/api/*.ts`)

Three routes: **`/api/run-factory`**, **`/api/regenerate`**, **`/api/update-positioning`**.

Each: reads the **raw** request body → validates payload shape server-side →
computes `HMAC-SHA256(rawBody, WEBHOOK_HMAC_SECRET)` via Web Crypto (`crypto.subtle`)
→ forwards the byte-identical body to Hermes → proxies Hermes's response.

**Signature scheme (Hermes must match):**
```
digest = HMAC-SHA256(rawRequestBody, WEBHOOK_HMAC_SECRET)   # hex, lowercase
header:  x-hermes-signature: sha256=<hexdigest>
```
Verify over the **raw** body **before** JSON parsing. The browser sends the
payload *unsigned*; only the Function ever holds the secret.

Frozen payloads:
- run-factory: `{"rows":[{company,domain,contact_title,vertical,contact_name?,notes?}]}`
- regenerate: `{"account_id":"","mode":"angle|instruction","angle":"","instruction":""}`
- update-positioning: `{"one_liner":"","proof_points":[{"tag":"technical|roi|gtm","text":""}],"tone_rules":[],"forbidden_claims":[],"verticals":[]}`

## Convex contract (for the backend agent)

The client uses `anyApi` (untyped) so it compiles before `convex/_generated` exists.
Function names live in one place: `src/lib/convexApi.ts`. Expected:

- **`query fleet.board()`** — reactive. Returns either `{ rows, stats }` or a bare
  `FleetRow[]` (stats are derived client-side if omitted). Per row:
  `account_id, company, stage, status(queued|in_progress|blocked|shipped),
  blocked_reason, cost_usd, url, updated_at`, and when available:
  `events{view,scroll50,cta}, qa{first_pass,total}, angle_log{angle,because_findings[],objection_addressed},
  design_system, signature_element, findings[]{claim,source_url,recency}, contact_title, vertical`.

See `src/lib/types.ts` for the exact TypeScript shapes.

## Graceful degradation / stubs

- **No `convex/_generated` yet:** `anyApi` stub in `src/lib/convexApi.ts`. Swap the
  import for the generated `api` when it lands; call sites don't change.
- **`VITE_CONVEX_URL` unset:** no Convex client is created; board shows a "no source"
  notice instead of crashing.
- **`fleet.board` missing/unreachable at runtime:** an error boundary catches the
  throwing query and renders an empty board + notice — the app shell stays usable.
- **Approve button:** there is no `approve` webhook in the frozen contract, so Approve
  is a client-side acknowledgement (the site is already live). Regenerate/instruction
  are the only pipeline-re-entry actions, per the "no path bypasses the gate" rule.
