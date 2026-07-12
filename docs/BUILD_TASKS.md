# BUILD_TASKS.md — sequenced Claude Code sessions

Run these in order. Each block is a prompt to paste into Claude Code (interactive) or run
via `claude -p "..."` for the mechanical ones. Acceptance criteria are the exit condition —
don't move on until they pass. Time boxes match PRD §19.

---

## Task 0 — Repo + environment bootstrap (human + Claude Code, 15 min)

Human does first (Claude Code must not touch secrets):
- Clone/init repo, copy CLAUDE.md, docs/, skills/ in.
- `.env` at repo root AND `~/.hermes/.env`: ANTHROPIC auth (or Max OAuth done via
  `hermes model`), LINKUP_API_KEY, CLOUDFLARE_API_TOKEN, CONVEX_DEPLOY_KEY, FACTORY_KEY
  (shared secret for /fleet and /trace), WEBHOOK_HMAC_SECRET.
- `/add-plugin convex` in Claude Code (or `claude mcp add convex -- npx -y convex@latest mcp start`).
- Start `npx convex dev` in a spare terminal and leave it running.

Prompt:
> Read CLAUDE.md fully. Then run scripts/install-skills.sh and `hermes doctor`. Report
> anything failing. Do not fix .env issues yourself — list them for me.

Accept: doctor clean (or only known-optional warnings), 4 skills listed by `hermes skills list`.

---

## Task 1 — Convex backend (45 min)

Prompt:
> Implement the Convex backend exactly per CLAUDE.md "Convex schema": tables fleet, traces,
> events with the listed indexes; queries for the fleet board (fleet with latest event counts
> joined, first-pass QA rate computed from traces where retry_of is null); HTTP actions
> /beacon, /fleet, /trace with the specified auth. Write a seed script inserting 3 fake
> accounts across different stages. Verify by running the seed and querying via the Convex
> MCP tools. Show me the dashboard data shape a frontend query returns.

Accept: `npx convex dev` deploys clean; seed visible via MCP `data` tool; /beacon rejects
unknown account_id; /fleet rejects missing x-factory-key.

---

## Task 2 — Pipeline tooling: research tool + Convex writes (45 min)

Prompt A (research tool):
> Build `scripts/linkup-research.mjs`: a CLI tool wrapping Linkup's raw POST
> https://api.linkup.so/v1/search (Bearer LINKUP_API_KEY from env). Args: --query (required),
> --depth standard|deep (default standard), --include-domains (optional CSV). Use
> outputType "structured" with a structuredOutputSchema matching the researcher findings
> contract in CLAUDE.md (findings[] with claim, source_url, recency, signal_type,
> hook_strength). Print the JSON to stdout; nonzero exit with the API error on failure;
> hard timeout 30s. Then update skills/account-researcher/SKILL.md: replace the generic
> "web/Linkup tools" instruction with explicit invocations of this tool, keeping the 6-query
> budget and the no-source-no-finding rule. Test with one real query and show me the output.

Prompt B (Convex glue):
> Add `scripts/factory-report.sh`: POSTs a JSON arg to /fleet or /trace with the FACTORY_KEY
> header, retries once, exits nonzero loudly on second failure. Update
> skills/distributor/SKILL.md and skills/qa-reviewer/SKILL.md to call it at every stage
> transition / trace write (JSONL + mirror). Keep frozen contracts intact. Reinstall skills
> and show me the diff.

Optional (post-buildathon or if ahead): register the official Linkup MCP for ad-hoc deep
research — `hermes mcp add linkup --command npx --args -y linkup-mcp-server apiKey=$LINKUP_API_KEY`
— then `hermes mcp test linkup`. Never used inside the automated pipeline.

Accept: linkup-research.mjs returns contract-shaped findings with real source_urls for a
test company; one manual qa-reviewer invocation on a fixture produces both a local JSONL
line and a Convex traces row.

---

## Task 3 — First end-to-end account (60 min — the proving hour)

Prompt:
> Using one real test row (I'll provide company/domain/title/vertical), drive one account
> through the full pipeline manually: invoke distributor with a single-row intake, follow
> research → QA → build → QA → wrangler deploy → QA. Do not parallelize. After each stage,
> show me the stage output JSON and the QA verdict. If QA fails, apply its retry_guidance
> once. At the end give me: the live URL, total cost, and all trace lines.

Accept: live URL loads; page has ≥3 cited claims, a signature element, the beacon script;
fleet row in Convex says shipped; traces exist for all three gates.
Note: the first page WILL be mediocre. Fix via microsite-builder skill + positioning
memory edits, re-run build stage only. Two iterations max before moving on.

---

## Task 3.5 — Lift to Railway (30 min, after the proving hour)

Human first: `railway login` done; create the service; attach a persistent volume mounted
at the container's `~/.hermes`; set all env vars in Railway (never in the image).

Prompt:
> Write the Dockerfile + railway deploy config for Hermes: base on the official image or
> the installer, `~/.hermes` on the mounted volume, gateway as the container entrypoint
> (`hermes gateway run`), one container = one profile. Add scripts/sync-skills-railway.sh
> that pushes repo skills into the volume and restarts the gateway. Deploy, run
> `hermes doctor` inside the container, and re-run the Task 3 test account end-to-end
> against the Railway instance. Report the stable public URL base for webhooks.

Accept: doctor clean in-container; test account ships from Railway; webhook base URL
recorded for Task 4. Rule: all skill edits still happen in the repo — sync script only.

---

## Task 4 — Webhooks (30 min)

Human first: `hermes webhook subscribe run-factory ...` and `... regenerate ...` and
`... update-positioning ...` (Claude Code drafts the exact commands below) against the
Railway-hosted Hermes, copy the returned URLs + secrets into the frontend's Pages
Function env config.

Prompt:
> Draft the three `hermes webhook subscribe` commands with prompt templates that map the
> CLAUDE.md payloads into skill invocations: run-factory → distributor with rows; regenerate
> → microsite-builder with previous html_path + packet + mode/instruction, then qa-reviewer,
> then deploy; update-positioning → rewrite the worker profile MEMORY.md sections. Then write
> `scripts/test-webhooks.sh` that fires signed sample payloads at each and checks for a fleet
> state change. I will run the subscribe commands myself.

Accept: test script shows all three round-trips causing visible state changes; unsigned
request is rejected.

---

## Task 5 — Frontend (75 min, cut-lines apply)

Prompt:
> Build the frontend per CLAUDE.md "Frontend screens", deployed to Cloudflare Pages, using
> Convex live queries. Prefer a Vite/React SPA + a Pages Function for the HMAC-signing
> route (the Function holds WEBHOOK_HMAC_SECRET and forwards signed payloads to the Hermes
> webhooks — the secret must never reach client code). Order of implementation (stop
> wherever time runs out, in this order): (1) Fleet board, (2) Intake with CSV
> parse/validate/dedupe posting through the signing Function, (3) Preview page with iframe +
> angle log + regenerate-with-instruction box, (4) GTM planner form. Visual bar: clean,
> fast, obviously-live; the fleet board is the demo centerpiece — blocked accounts must
> show their QA failure text verbatim.

Accept per cut-line: (1) board live-updates when I mutate fleet via MCP; (2) a pasted CSV
row appears as queued; (3) an instruction round-trips to a redeployed site; (4) planner
save rewrites memory.

---

## Task 6 — Fleet run + hardening (45 min)

Prompt:
> Run the factory on the 20-row CSV I provide (max 5 in flight). While it runs, tail
> hermes logs and the traces table; summarize failures by QA check id. After completion:
> report first-pass QA rate per stage, total cost, cost per site, and the three worst
> failure classes with one suggested skill fix each. Apply the single highest-impact fix,
> re-run only the blocked accounts.

Accept: ≥15 shipped, blocked accounts have legible reasons, health metrics on the board.

---

## Task 7 — Demo prep (30 min)

Prompt:
> Write scripts/demo-check.sh verifying: tunnel up, webhooks respond, Convex reachable,
> 20 fleet rows shipped, beacon test event round-trips, wrangler auth valid. Then dry-run
> the PRD §18 demo path on a fresh company and time each phase.

Accept: check script green; judge-company dry run under 4 minutes; fallback pipeline log
saved for the tunnel-death scenario.

---

## Standing instructions for every session

- Re-read CLAUDE.md if the session is fresh. Contracts are frozen; propose changes, don't make them.
- After any skill edit: reinstall, single-account test, read traces, THEN proceed.
- Never touch ~/.hermes/.env or run hermes update/uninstall.
- When blocked on missing types, check that `npx convex dev` is running before refactoring.
