import { internalMutation } from "./_generated/server";

// Seed 3 fake accounts across DIFFERENT stages. Run via:
//   npx convex run seed:run
//
// Idempotent: it first deletes any existing fleet/events/traces rows for the
// three seed account_ids, then re-inserts, so repeated runs don't duplicate.

const MODEL = "claude-sonnet-4-5-20250929";
const RUBRIC = "1.0";

const ACCOUNTS = [
  "northwind-freight-cto", // queued  / research
  "vertex-payments-cfo", //   in_progress / build
  "helix-health-vp-eng", //   shipped  / deploy
];

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    // ---- cleanup (idempotency) -------------------------------------------
    for (const id of ACCOUNTS) {
      for (const row of await ctx.db
        .query("fleet")
        .withIndex("by_account_id", (q) => q.eq("account_id", id))
        .collect())
        await ctx.db.delete(row._id);
      for (const row of await ctx.db
        .query("events")
        .withIndex("by_account_id", (q) => q.eq("account_id", id))
        .collect())
        await ctx.db.delete(row._id);
      for (const row of await ctx.db
        .query("traces")
        .withIndex("by_account_id", (q) => q.eq("account_id", id))
        .collect())
        await ctx.db.delete(row._id);
    }

    const t = (iso: string) => Date.parse(iso);

    // ---- Account 1: QUEUED, stage research, no work done yet -------------
    await ctx.db.insert("fleet", {
      account_id: "northwind-freight-cto",
      company: "Northwind Freight",
      stage: "research",
      status: "queued",
      cost_usd: 0,
      updated_at: t("2026-07-12T09:00:00Z"),
    });

    // ---- Account 2: IN_PROGRESS, stage build, partial cost ---------------
    // Research passed on first attempt; build is underway (no build trace yet).
    await ctx.db.insert("fleet", {
      account_id: "vertex-payments-cfo",
      company: "Vertex Payments",
      stage: "build",
      status: "in_progress",
      cost_usd: 0.92,
      updated_at: t("2026-07-12T09:41:00Z"),
    });
    await ctx.db.insert("traces", {
      trace_id: "tr-vertex-research-1",
      ts: "2026-07-12T09:33:00Z",
      account_id: "vertex-payments-cfo",
      stage: "research",
      input_ref: "intake/vertex-payments-cfo.json",
      output_ref: "packets/vertex-payments-cfo.json",
      verdict: { pass: true, failures: [] },
      rubric_version: RUBRIC,
      model: MODEL,
      cost_usd: 0.41,
      latency_s: 22.4,
      retry_of: null,
    });

    // ---- Account 3: SHIPPED, stage deploy, live URL + events + traces ----
    await ctx.db.insert("fleet", {
      account_id: "helix-health-vp-eng",
      company: "Helix Health",
      stage: "deploy",
      status: "shipped",
      cost_usd: 1.74,
      url: "https://helix-health-vp-eng.pages.dev",
      updated_at: t("2026-07-12T10:05:00Z"),
    });

    // A few real-visit beacon events (view/scroll50/cta).
    const helixEvents: Array<["view" | "scroll50" | "cta", string]> = [
      ["view", "2026-07-12T10:12:00Z"],
      ["view", "2026-07-12T10:19:00Z"],
      ["view", "2026-07-12T10:44:00Z"],
      ["view", "2026-07-12T11:02:00Z"],
      ["view", "2026-07-12T11:28:00Z"],
      ["scroll50", "2026-07-12T10:19:20Z"],
      ["scroll50", "2026-07-12T11:02:35Z"],
      ["cta", "2026-07-12T11:03:10Z"],
    ];
    for (const [type, iso] of helixEvents) {
      await ctx.db.insert("events", {
        account_id: "helix-health-vp-eng",
        type,
        ts: t(iso),
      });
    }

    // Traces: research pass -> build FAIL -> build retry pass -> deploy pass.
    // The build retry (retry_of != null) is excluded from first-pass math, so
    // build's first-pass rate is 0/1 while overall first-pass is 2/3.
    await ctx.db.insert("traces", {
      trace_id: "tr-helix-research-1",
      ts: "2026-07-12T09:48:00Z",
      account_id: "helix-health-vp-eng",
      stage: "research",
      input_ref: "intake/helix-health-vp-eng.json",
      output_ref: "packets/helix-health-vp-eng.json",
      verdict: { pass: true, failures: [] },
      rubric_version: RUBRIC,
      model: MODEL,
      cost_usd: 0.44,
      latency_s: 25.1,
      retry_of: null,
    });
    await ctx.db.insert("traces", {
      trace_id: "tr-helix-build-1",
      ts: "2026-07-12T09:55:00Z",
      account_id: "helix-health-vp-eng",
      stage: "build",
      input_ref: "packets/helix-health-vp-eng.json",
      output_ref: "sites/helix-health-vp-eng/index.html@v1",
      verdict: {
        pass: false,
        failures: [
          {
            check: "positioning_claim_grounding",
            detail:
              "Hero claim 'cuts clinical onboarding time by 80%' is absent from positioning memory",
            severity: "block",
          },
        ],
      },
      rubric_version: RUBRIC,
      model: MODEL,
      cost_usd: 0.39,
      latency_s: 18.7,
      retry_of: null,
    });
    await ctx.db.insert("traces", {
      trace_id: "tr-helix-build-2",
      ts: "2026-07-12T09:59:00Z",
      account_id: "helix-health-vp-eng",
      stage: "build",
      input_ref: "packets/helix-health-vp-eng.json",
      output_ref: "sites/helix-health-vp-eng/index.html@v2",
      verdict: { pass: true, failures: [] },
      rubric_version: RUBRIC,
      model: MODEL,
      cost_usd: 0.37,
      latency_s: 17.9,
      retry_of: "tr-helix-build-1", // <-- retry, excluded from first-pass
    });
    await ctx.db.insert("traces", {
      trace_id: "tr-helix-deploy-1",
      ts: "2026-07-12T10:04:00Z",
      account_id: "helix-health-vp-eng",
      stage: "deploy",
      input_ref: "sites/helix-health-vp-eng/index.html@v2",
      output_ref: "https://helix-health-vp-eng.pages.dev",
      verdict: { pass: true, failures: [] },
      rubric_version: RUBRIC,
      model: MODEL,
      cost_usd: 0.13,
      latency_s: 9.2,
      retry_of: null,
    });

    return {
      seeded_accounts: ACCOUNTS,
      fleet_rows: 3,
      events: helixEvents.length,
      traces: 5,
    };
  },
});
