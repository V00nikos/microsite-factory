import { query } from "./_generated/server";
import { v } from "convex/values";

// Public read queries for the frontend fleet board & preview screen.
// (Reads go straight to Convex — dashboard reads never touch Hermes.)

const STAGES = ["research", "build", "deploy"] as const;
type Stage = (typeof STAGES)[number];

// Minimal shape needed for the first-pass computation — avoids depending on
// generated Doc types (which don't exist until `convex dev` runs).
type TraceLike = {
  stage: string;
  retry_of: string | null;
  verdict: { pass: boolean };
};

type StageRate = { first_pass: number; passed: number; rate: number | null };

type FirstPassQa = {
  by_stage: Record<Stage, StageRate>;
  overall: StageRate;
};

// First-pass QA rate: over traces where retry_of === null, the fraction with
// verdict.pass === true — computed per stage AND overall.
// rate is null when there are no first-pass traces yet (avoids 0/0 = "0%").
function computeFirstPass(traces: TraceLike[]): FirstPassQa {
  const by_stage = {
    research: { first_pass: 0, passed: 0, rate: null as number | null },
    build: { first_pass: 0, passed: 0, rate: null as number | null },
    deploy: { first_pass: 0, passed: 0, rate: null as number | null },
  } satisfies Record<Stage, StageRate>;

  let firstTotal = 0;
  let passTotal = 0;

  for (const t of traces) {
    if (t.retry_of !== null) continue; // first-pass only (exclude retries)
    const bucket = by_stage[t.stage as Stage];
    if (!bucket) continue;
    bucket.first_pass += 1;
    firstTotal += 1;
    if (t.verdict?.pass === true) {
      bucket.passed += 1;
      passTotal += 1;
    }
  }

  for (const s of STAGES) {
    const b = by_stage[s];
    b.rate = b.first_pass > 0 ? b.passed / b.first_pass : null;
  }

  return {
    by_stage,
    overall: {
      first_pass: firstTotal,
      passed: passTotal,
      rate: firstTotal > 0 ? passTotal / firstTotal : null,
    },
  };
}

// ---------------------------------------------------------------------------
// fleetBoard — every fleet row joined with per-type event counts and the
// first-pass QA rate for that account, plus fleet-wide totals & first-pass.
// See the documented return shape in the file's accompanying report.
// ---------------------------------------------------------------------------
export const fleetBoard = query({
  args: {},
  handler: async (ctx) => {
    const fleet = await ctx.db.query("fleet").collect();

    const accounts = [];
    for (const f of fleet) {
      const events = await ctx.db
        .query("events")
        .withIndex("by_account_id", (q) => q.eq("account_id", f.account_id))
        .collect();
      const event_counts = { view: 0, scroll50: 0, cta: 0 };
      for (const e of events) event_counts[e.type] += 1;

      const traces = await ctx.db
        .query("traces")
        .withIndex("by_account_id", (q) => q.eq("account_id", f.account_id))
        .collect();

      accounts.push({
        account_id: f.account_id,
        company: f.company,
        stage: f.stage,
        status: f.status,
        blocked_reason: f.blocked_reason ?? null,
        cost_usd: f.cost_usd,
        url: f.url ?? null,
        updated_at: f.updated_at,
        event_counts,
        trace_count: traces.length,
        first_pass_qa: computeFirstPass(traces),
      });
    }

    // most-recently-updated first
    accounts.sort((a, b) => b.updated_at - a.updated_at);

    // fleet-wide first-pass over ALL traces
    const allTraces = await ctx.db.query("traces").collect();

    const totals = {
      accounts: accounts.length,
      queued: accounts.filter((a) => a.status === "queued").length,
      in_progress: accounts.filter((a) => a.status === "in_progress").length,
      blocked: accounts.filter((a) => a.status === "blocked").length,
      shipped: accounts.filter((a) => a.status === "shipped").length,
      cost_usd: accounts.reduce((sum, a) => sum + (a.cost_usd ?? 0), 0),
      events: accounts.reduce(
        (acc, a) => ({
          view: acc.view + a.event_counts.view,
          scroll50: acc.scroll50 + a.event_counts.scroll50,
          cta: acc.cta + a.event_counts.cta,
        }),
        { view: 0, scroll50: 0, cta: 0 },
      ),
    };

    return {
      accounts,
      totals,
      first_pass_qa: computeFirstPass(allTraces), // fleet-wide
    };
  },
});

// ---------------------------------------------------------------------------
// tracesForAccount — full trace history for one account (preview screen &
// blocked-reason drill-down), oldest first.
// ---------------------------------------------------------------------------
export const tracesForAccount = query({
  args: { account_id: v.string() },
  handler: async (ctx, args) => {
    const traces = await ctx.db
      .query("traces")
      .withIndex("by_account_id", (q) => q.eq("account_id", args.account_id))
      .collect();
    traces.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    return traces;
  },
});

// ---------------------------------------------------------------------------
// recentTraces — the newest trace rows across the whole fleet, newest-first.
// Powers the console's live Activity log ("what's done"). Ordered by insertion
// (.order("desc") = newest _creationTime first) and capped so the feed stays
// cheap. Returns only the fields the log renders — not the full trace row.
// ---------------------------------------------------------------------------
export const recentTraces = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    // clamp: default 30, floor 1, hard ceiling 100
    const requested = Math.floor(args.limit ?? 30);
    const limit = Math.max(1, Math.min(100, isFinite(requested) ? requested : 30));

    const rows = await ctx.db.query("traces").order("desc").take(limit);

    return rows.map((t) => ({
      trace_id: t.trace_id,
      ts: t.ts,
      account_id: t.account_id,
      stage: t.stage,
      verdict: { pass: t.verdict.pass, failures: t.verdict.failures },
      retry_of: t.retry_of,
      rubric_version: t.rubric_version,
      model: t.model,
    }));
  },
});

// ---------------------------------------------------------------------------
// recentActivity — the newest rows from the fine-grained `activity` stream
// (mirrored from the Hermes gateway log), newest-first. Powers the console's
// live "minute activity" feed — every Linkup query, browser QA step, file
// write, wrangler deploy, pipeline transition, and error as it happens.
// Ordered by insertion (.order("desc") = newest _creationTime first) and
// clamped (default 40, max 200) so the feed stays cheap.
// ---------------------------------------------------------------------------
export const recentActivity = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    // clamp: default 40, floor 1, hard ceiling 200
    const requested = Math.floor(args.limit ?? 40);
    const limit = Math.max(1, Math.min(200, isFinite(requested) ? requested : 40));

    const rows = await ctx.db.query("activity").order("desc").take(limit);

    return rows.map((a) => ({
      ts: a.ts,
      account_id: a.account_id ?? null,
      kind: a.kind,
      message: a.message,
    }));
  },
});

// ---------------------------------------------------------------------------
// accountDetail — one fleet row + its event counts + traces + first-pass QA.
// Convenience for the Preview + edit screen.
// ---------------------------------------------------------------------------
export const accountDetail = query({
  args: { account_id: v.string() },
  handler: async (ctx, args) => {
    const fleetRow = await ctx.db
      .query("fleet")
      .withIndex("by_account_id", (q) => q.eq("account_id", args.account_id))
      .unique();
    if (!fleetRow) return null;

    const events = await ctx.db
      .query("events")
      .withIndex("by_account_id", (q) => q.eq("account_id", args.account_id))
      .collect();
    const event_counts = { view: 0, scroll50: 0, cta: 0 };
    for (const e of events) event_counts[e.type] += 1;

    const traces = await ctx.db
      .query("traces")
      .withIndex("by_account_id", (q) => q.eq("account_id", args.account_id))
      .collect();
    traces.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

    return {
      fleet: fleetRow,
      event_counts,
      traces,
      first_pass_qa: computeFirstPass(traces),
    };
  },
});
