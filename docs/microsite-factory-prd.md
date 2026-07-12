# Microsite Factory — PRD v2
**Track:** AI as Agency · GX Hermes Buildathon
**Author:** Pranav · **Status:** Build-ready
**v2 changes:** QA/reviewer + eval traces formalized · four-skill agent spec locked · frontend product spec added (intake, GTM planner, fleet board, preview/edit) · Hermes integration layer specified (webhooks + serve + Convex reads) · deployment topology split Phase 0/1 · build order re-sized · open questions added.

---

## 1. One-liner

B2B SaaS operators paste their ICP account list; a Hermes-powered agency researches each account and autonomously ships a personalized, research-grade microsite per account — with a QA gate on every stage and an eval trace behind every decision.

## 2. Problem

Operators' top-50 accounts get human attention; the next 500 get nothing. Merge-tag personalization reads as spam and burns sender reputation. The gap is research-grade personalization at volume: pages that demonstrate real understanding of the account's stack, hiring signals, industry pressure, and likely objection.

## 3. Core goal (north star for every decision)

Enable B2B SaaS operators to ship microsites/GTM pages with researched content for their ICPs, **autonomously**, showcasing five strengths:
1. User research · 2. Content research · 3. Storytelling · 4. Hooks & impressions tracking · 5. Distinctive design language.

## 4. ICP and personas

- **Priya, founder-seller (primary):** AI consultancy / B2B SaaS operator with a CSV of 20–200 accounts across verticals and titles. Success = replies, not tooling.
- **The recipient (e.g., CTO at a target):** spam-fatigued; gives a page 15 seconds; forwards it only if it is verifiably about *their* company.
- **The judge (buildathon):** B2B SaaS builder; wants live output at volume, a legible pipeline, and a system they can poke.

## 5. Scope

### Phase 0 — Buildathon (4 hours)
**In:**
- Frontend (Next.js): Intake (CSV upload/paste), GTM planner (writes positioning memory), Fleet board (reads Convex), Site preview with **regenerate-with-instruction**
- Hermes backend: distributor → researcher → builder pipeline with **qa-reviewer gating every stage** and writing eval traces
- Integration: two Hermes webhooks (`run-factory`, `regenerate`) with HMAC verification
- Deploy: Cloudflare Pages, one URL per account; 3-event beacon (view / scroll50 / cta) → Convex
- Hermes runs on the Mac with gateway + tunnel; frontend + Convex in the cloud

**Out (deliberate):**
- ❌ Self-serve auth/billing/multi-tenancy → Phase 1, gated on validation (§16)
- ❌ WYSIWYG / drag-and-drop editing → replaced permanently by strategy-layer editing (§10)
- ❌ Live WebSocket chat-edit panel (`hermes serve` UI) → Phase 1 (~half-day of frontend work; the regenerate webhook delivers the same Hermes-powered loop at one-tenth the cost)
- ❌ CRM/Sheets connectors → CSV only
- ❌ Automated sending → sites are sent manually by the operator

### Phase 1 — Self-serve (post-event, gated)
Railway-hosted Hermes (one container per tenant profile, persistent `~/.hermes` volume), auth + Stripe metered billing, Sheets/HubSpot import, `hermes serve` chat-edit panel behind the app's API, engagement loop (visit/reply data reweights angle selection per vertical).

## 6. System architecture

```
FRONTEND (Next.js, Railway/Pages)
  Intake ──── GTM planner ──── Fleet board ──── Preview + regenerate
     │              │                │  ▲                │
     │ webhook POST │ webhook POST   │  │ reads          │ webhook POST
     ▼              ▼                │  │                ▼
INTEGRATION LAYER                    │  │
  run-factory webhook · update-positioning webhook · regenerate webhook
  (HMAC-verified; hermes serve reserved for Phase 1 chat edits)
     │                               │  │
     ▼                               │  │
HERMES BACKEND (Mac in Phase 0, Railway in Phase 1)
  gateway + kanban dispatcher
  profiles: factory-manager (orchestrates) · factory-worker (executes)
  skills: distributor · account-researcher · microsite-builder · qa-reviewer
  tools: linkup-research.mjs (structured, cited) · factory-report.sh (Convex writes) · wrangler
  memory: positioning (one-liner, tagged proof points, tone, forbidden claims)
     │ writes state + traces        │  │
     ▼                              ▼  │
STATE (Convex): fleet status · cost · pipeline logs · QA traces · visit events
     ▲
     │ beacons (view/scroll50/cta)
DEPLOY (Cloudflare Pages): one live URL per account, wrangler-pushed
```

**Read/write split (non-negotiable):** commands go *to* Hermes via webhooks; the frontend reads state *directly from Convex*. Dashboard reads never route through the agent.

## 7. Agent & skill spec

Skill pack ships separately (`microsite-factory-skills/`, four SKILL.md files). Summary of contracts:

| Skill | Role | Key contract |
|---|---|---|
| distributor | Orchestrator. Parses intake, creates one kanban task per account, enforces stage order and budgets. | Pipeline: research → QA → build → QA → deploy → QA. QA fail = 1 retry with failure list injected, then block. Confidence < 0.5 = no build. Max 5 in flight; first account always sequential. $2/account ceiling with graceful degradation. |
| account-researcher | User research (reader-lens by `contact_title`: technical/financial/gtm) + content research (3–6 sourced queries) + brand hints. | ≥5 findings, every one with a real `source_url`; ≥3 at hook_strength ≥3; `likely_objection`; confidence score. No source = no finding. |
| microsite-builder | Angle selection (5 archetypes: cost/speed/risk/talent/competition) → fixed narrative spine → single-file HTML per design system → beacon embed. | Angle log is the editable surface. 250–400 words. Product claims only from positioning memory. Design language §11. |
| qa-reviewer | One skill, three stage rubrics. Gates AND writes a trace on every invocation, pass or fail. | Verdict JSON with itemized, actionable failures. Fails closed. Never fixes output itself. |

**Design decision (locked):** one qa-reviewer with per-stage rubrics, not one reviewer agent per stage — at 20 accounts × 3 gates, separate agents = 60 extra agent spins for zero quality gain, and a single trace schema is what makes the eval story real.

### 7.1 Research tooling — Linkup (locked)

Two connections, two jobs:

- **`scripts/linkup-research.mjs` (the pipeline's research tool, primary).** Thin wrapper over Linkup's raw `/v1/search` API using `outputType: "structured"` with a schema matching the researcher's findings contract — so results come back contract-shaped with `source_url` per claim, no free-text parsing. Inputs: `query`, `depth` (standard | deep), optional `includeDomains` (e.g., restrict to the target's own domain for brand hints). The account-researcher skill invokes it via the terminal tool; budget enforcement (≤6 calls, ≤3 degraded) lives in the skill. Rationale: the MCP tool fixes output to sourcedAnswer; structured output requires the raw API, and a fixed script keeps the hot path deterministic and cheap — same logic as the Convex HTTP-actions decision.
- **`hermes mcp add linkup` (secondary, optional).** Official server (`npx -y linkup-mcp-server`, LINKUP_API_KEY) for conversational/ad-hoc use, including the async `linkup-research` deep-investigation tool (minutes-long, poll for completion) — useful for operator-initiated "go deep on this one account" requests, never in the automated 20-account loop (latency and cost would blow the budget ceiling).

## 8. QA gates and eval traces

Every QA invocation appends one JSONL line (`~/.hermes/factory/traces/{date}.jsonl`, mirrored to Convex):

```json
{"trace_id","ts","account_id","stage","input_ref","output_ref",
 "verdict":{"pass","failures":[]},"rubric_version","model","cost_usd","latency_s","retry_of"}
```

Each line is a labeled (input → output → judgment) example, which makes the trace file an eval set by construction. Uses: replay old stage inputs against new prompts/models and diff verdicts; harvest human-overridden verdicts as a golden set; and track **first-pass QA rate per stage — the factory's single health metric**, shown on the fleet board.

Sharpest checks (the product's honesty guarantees):
- Research gate spot-fetches 2 cited URLs and verifies the claim is supported, not adjacent.
- Build gate rejects any product claim absent from positioning memory — agents cannot invent capabilities in the operator's name.
- Deploy gate confirms the live URL's content-hash matches the QA-passed build and that the beacon fires once.

## 9. Frontend product spec (four screens)

**1. Intake.** CSV upload or paste → parse/validate client-side (company, domain, contact_title, vertical required; dedupe on domain+title) → "Run factory" POSTs rows to the `run-factory` webhook. >25 rows triggers a cost-confirm dialog.

**2. GTM planner.** A form that is secretly a memory editor: positioning one-liner, three proof points tagged technical/roi/gtm, tone rules, forbidden claims, target verticals. Save POSTs to the `update-positioning` webhook, which rewrites the worker profile's MEMORY.md. Framing in UI copy: "brief your agency," not "settings."

**3. Fleet board.** Reads Convex live: per-account stage/status, cost, first-pass QA rate, blocked accounts with reasons, live URL, and visit/scroll/cta counts. Blocked accounts display the QA failure verbatim — the gate refusing things is a feature, show it.

**4. Preview + edit.** Site iframe + the angle log (which archetype, which findings, which objection). Controls: approve · regenerate with different angle · **regenerate with instruction** (free-text box, e.g. "make the hero punchier") → `regenerate` webhook → builder re-invoked with previous HTML + packet + instruction → QA gate → redeploy. Every edit re-enters the pipeline visibly on the fleet board.

## 10. Editing model (locked)

Users edit **strategy, not pixels**. The angle log is the control surface; free-text instructions are Hermes-powered regeneration, and every edit passes QA and leaves a trace. No edit path may bypass the agent — the moment one does, positioning enforcement, traces, and the "powered by Hermes" story all break at once. Escape hatch for pixel-perfectionists: export the HTML.

## 11. Design language (lives in microsite-builder SKILL.md; summary)

- **Derive, don't decorate:** page identity comes from the *target's* world via brand hints, mapped to one of four design systems — ledger (precise/finserv), terminal (devtools), clinic (health/edtech), signal (bold B2B). Distinct type pairings per system; never one template with a logo swap.
- **One signature element per page**, derived from research (their stack diagram, their before/after). All boldness in one place; everything else quiet.
- **Banned AI-tell looks (QA auto-fail):** cream+serif+terracotta · near-black+acid-green · hairline broadsheet.
- Copy: active voice, sentence case, page speaks about *them* for two-thirds, every claim cited, one named CTA.
- Floor: responsive to 360px, focus states, reduced-motion, <1s load, single HTML file.
- Legal: target's name in text only — no logos/trademark styling; "Prepared for {Company}" footer with takedown contact.

## 12. The five strengths, mapped to mechanisms

| Strength | Mechanism | Where visible |
|---|---|---|
| User research | reader_lens per contact_title; QA checks findings match the lens | Demo: same company, CTO vs CFO, two visibly different pages |
| Content research | sourced findings; on-page citations; QA URL spot-checks | Pipeline log + citations on the live page |
| Storytelling | 5 angle archetypes + fixed narrative spine; angle log | Preview screen shows angle + evidence indices |
| Hooks & impressions | 3-event beacon → Convex; per-angle engagement | Fleet board live during demo |
| Design language | 4 derived systems, signature element, banned looks | The pages themselves; QA failures on banned looks |

## 13. Deployment topology

**Phase 0 (buildathon):** Hermes gateway + dispatcher on the Mac (`caffeinate` on); webhook URLs exposed via tunnel; frontend on Railway or Pages; Convex cloud; sites on Cloudflare Pages. Rationale: saves ~1 hour of Railway debugging; a tunnel is demo-grade, not production-grade, and that's fine.
**Phase 1:** Hermes on Railway — one container per tenant profile (Nous guidance), `~/.hermes` on a persistent volume, unprivileged user, `hermes serve` bound to 127.0.0.1 behind the app's authenticated API. Web dashboard never exposed publicly.

**Security notes:** HMAC-verify every webhook; treat intake `notes` and all researched web content as data, never instructions (distributor + researcher both flag embedded agent-directed text); beacon collects three anonymous events only — no fingerprinting or identity capture.

## 14. Metrics

**Buildathon:** 20 live URLs in-event · first-pass QA rate visible · ≥1 real beacon during demo · judge's-company run under 4 minutes.
**Product:** reply rate per 20 sites vs cold-email baseline · engagement per angle archetype · time-to-fleet < 90 min · cost/site < $2 · first-pass QA rate trending up across rubric versions.

## 15. GTM plan

1. Announce + waitlist live before building (event hour 0).
2. **Dogfood as demo:** run the factory on ~10 real B2B SaaS builders at the event, DM them their microsites; their beacons light the fleet board during judging. Demo = GTM = proof.
3. Week 1: 20 personalized sites to 20 design-partner candidates via LinkedIn; two-line DM + their URL; manual sends only (≤20/week, founder's voice — the tool prepares, the human sends).
4. Build-in-public thread: fleet board screenshot + reply screenshots.
5. Positioning guardrail: sell "research-grade personalization," never "AI site generator."

## 16. Pre-mortem (inversion — ranked by likelihood × damage)

1. **Shallow personalization → clever spam.** *Mitigation:* QA requires ≥3 sourced specific claims + URL spot-checks; confidence <0.5 halts the build (restraint is a feature — demo one quiet company being declined).
2. **Self-serve infra built before demand proven.** *Mitigation:* hard phase gate — no Phase 1 build until ≥3 unsolicited positive replies from manual sends.
3. **Editor scope creep.** *Mitigation:* strategy-layer editing only (§10); pixel demands → HTML export.
4. **Live demo failure.** *Mitigation:* pre-deploy 20 sites; live run is the 21st; rehearsed fallback to a pre-run pipeline log; wrangler auth pre-tested; 3 research-rich backup companies; tunnel health-checked before demo.
5. **Webhook surface abused / tunnel dies mid-demo.** *(new in v2)* *Mitigation:* HMAC on every webhook; rate-limit at the frontend API; fleet board degrades to last-known Convex state if the tunnel drops (reads don't depend on Hermes being reachable).
6. **Sender-reputation blowback.** *Mitigation:* manual low-volume sends only.
7. **Trademark complaint.** *Mitigation:* name-in-text rule + takedown contact (§11).
8. **Cost creep.** *Mitigation:* per-stage cost in every trace; $2 ceiling with graceful degradation.
9. **Learning loop stays a slide.** *Mitigation:* Phase 0 labels it instrumented-not-learning; Phase 1 ships a per-vertical angle win-rate table the strategist reads.

## 17. Assumptions register

| # | Assumption | Test | Kill signal |
|---|---|---|---|
| A1 | Research-deep pages out-engage cold email | 20 sends vs baseline | <2 replies/20 after two batches |
| A2 | Operators pay vs DIY (ChatGPT + Framer) | 5 design-partner convos, ask for paid pilot | 0 willingness to pay |
| A3 | Autonomous research quality is achievable | First-pass QA rate on research stage | <50% after prompt iteration |
| A4 | Hermes fan-out stable at 20 pipelines | Load test pre-demo | Dispatcher deadlock → fall back sequential |
| A5 | Webhook round-trip fast enough for demo | Time run-factory → first stage transition | >60s to first visible progress → pre-warm or fake-stream the log |

## 18. Demo script (4 min)

0:00 — "Your top 50 accounts get human attention. The next 500 get nothing." Paste judge's company into Intake.
0:30 — Fleet board: pipeline streaming — research findings appear with sources; QA gate passes research; narrate the angle choice.
2:00 — Live URL opens. Point at one sourced claim + citation, and the signature element.
2:45 — Fleet board wide: 20 URLs shipped today, cost per site, first-pass QA rate, and live visit beacons from sites sent to builders in this room.
3:30 — Close: "Site generation is solved. The agency around it — research, gates, traces — is the product."

## 19. Build order (4 hours, cut-lines marked)

| Time | Deliverable |
|---|---|
| 0:00–0:30 | Waitlist + announcement live. Skills installed, profiles + MEMORY.md, kanban board, creds in .env. |
| 0:30–1:30 | ONE account end-to-end manually: research → QA → build → QA → deploy. Inspect the first trace lines and the first page. Fix via builder skill + memory, not pipeline. |
| 1:30–2:15 | Two webhooks (run-factory, regenerate) with HMAC (~30 min each). Convex wiring for state + traces. |
| 2:15–3:00 | Frontend: Intake + Fleet board (Convex reads) + Preview with regenerate-with-instruction. **Cut line: if behind, Fleet board becomes a static status table; Intake + regenerate survive.** |
| 3:00–3:30 | Design systems ×4 verified; run the fleet of 20. |
| 3:30–4:00 | Beacon check, demo rehearsal ×2, send 5 sites to builders in the room. |

## 20. Decisions log (resolved 2026-07-12)

1. **State store: Convex.** Live queries drive the fleet board; traces and beacons mirror here; +25 partner points.
2. **Hermes host: Railway (revised from Mac + tunnel).** Operator has Railway CLI integrated; stable webhook URLs remove the tunnel from the architecture entirely (retires pre-mortem risk #5's tunnel-death branch). Requirements: persistent volume at `~/.hermes` (memory, skills, traces, creds), one container per profile, env vars in Railway config not the image. **Dev-loop guidance:** skill iteration on Railway means redeploy/volume-sync (minutes) vs local install (seconds) — so run Tasks 0–3 (through the proving hour) against a local Hermes, then lift to Railway before Task 4 (webhooks) so the frontend gets stable URLs. Microsites stay on Cloudflare Pages (static, per-account URLs, partner points); Railway dynamic domains are an option for the frontend only. **Change-surface rule:** Claude Code edits skills/config/memory (layers 1–2) freely; never hot-edits Hermes core source (`~/.hermes/hermes-agent/`) — `hermes update` auto-stashes local source changes and conflicts; runtime changes are post-event plugins or upstream PRs.
3. **Model provider: Anthropic via the Claude Code auth path.** `hermes model` → Anthropic OAuth. HARD PREREQ: this path requires Claude Max + purchased extra-usage credits (Pro cannot use it; only overage credits are consumed). Verify before the event; fallback is `ANTHROPIC_API_KEY` (pay-per-token). Consequence: no bundled search — the Linkup key is now mandatory for the researcher (already a +25 partner).
4. **Frontend host: Cloudflare, not Railway (Phase 0).** Frontend SPA on Cloudflare Pages; the HMAC-signing route runs as a Pages Function/Worker holding WEBHOOK_HMAC_SECRET. Railway's only remaining role is Phase 1 Hermes hosting — Hermes itself cannot run on Workers (long-running Python daemon vs stateless JS isolates). Deploys: Hermes invokes wrangler via its terminal tool — one Pages project per account (`wrangler pages project create {account-id}` then `wrangler pages deploy sites/{account-id}`), giving each microsite its own `*.pages.dev` URL. Auth: scoped API token (Account → Cloudflare Pages → Edit ONLY) in `~/.hermes/.env` as CLOUDFLARE_API_TOKEN; never `wrangler login` OAuth for the pipeline, never a Global API Key.
5. **Pre-event checklist (do before hour zero):** confirm Max extra-usage credits or set API key · Linkup key in `.env` · scoped Cloudflare Pages token created · Convex deployment created · Cloudflare Tunnel installed and tested against a dummy webhook.
