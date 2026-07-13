import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Shared validators (mirror the frozen data contracts in CLAUDE.md).
// Exported so mutations.ts / queries.ts reuse the exact same shapes.
// ---------------------------------------------------------------------------

// fleet.status union
export const fleetStatus = v.union(
  v.literal("queued"),
  v.literal("in_progress"),
  v.literal("blocked"),
  v.literal("shipped"),
);

// pipeline stage (research -> build -> deploy). Used by fleet.stage and traces.stage.
export const stageValidator = v.union(
  v.literal("research"),
  v.literal("build"),
  v.literal("deploy"),
);

// events.type — EXACTLY the three anonymous beacon events. No identity fields.
export const eventType = v.union(
  v.literal("view"),
  v.literal("scroll50"),
  v.literal("cta"),
);

// traces.verdict — the QA verdict embedded in the trace line.
// Contract: {"pass": boolean, "failures": [ {check, detail, severity:"block|warn"} ]}.
// failures items are validated as v.any() so a valid trace write is never rejected
// on a failure-item shape mismatch (the QA-reviewer skill owns that shape).
export const verdictValidator = v.object({
  pass: v.boolean(),
  failures: v.array(v.any()),
});

export default defineSchema({
  // -------------------------------------------------------------------------
  // fleet — one row per account, upserted by the pipeline after every stage
  // transition (POST /fleet). updated_at is stored as epoch milliseconds
  // (number); the pipeline sends ISO8601 and the /fleet action coerces it.
  // -------------------------------------------------------------------------
  fleet: defineTable({
    account_id: v.string(),
    company: v.string(),
    stage: stageValidator,
    status: fleetStatus,
    blocked_reason: v.optional(v.string()),
    cost_usd: v.number(),
    url: v.optional(v.string()),
    updated_at: v.number(), // epoch ms (see note above)
  }).index("by_account_id", ["account_id"]),

  // -------------------------------------------------------------------------
  // traces — mirror of the JSONL trace line, one row per QA invocation.
  // ts is the ISO8601 string from the trace line. retry_of is nullable.
  // Indexed on account_id AND stage (per CLAUDE.md).
  // -------------------------------------------------------------------------
  traces: defineTable({
    trace_id: v.string(),
    ts: v.string(),
    account_id: v.string(),
    stage: stageValidator,
    input_ref: v.string(),
    output_ref: v.string(),
    verdict: verdictValidator,
    rubric_version: v.string(),
    model: v.string(),
    cost_usd: v.number(),
    latency_s: v.number(),
    retry_of: v.union(v.string(), v.null()),
  })
    .index("by_account_id", ["account_id"])
    .index("by_stage", ["stage"]),

  // -------------------------------------------------------------------------
  // events — the 3-event beacon stream. EXACTLY three fields; no fingerprint
  // or identity capture. ts is epoch ms (coerced at the /beacon boundary).
  // -------------------------------------------------------------------------
  events: defineTable({
    account_id: v.string(),
    type: eventType,
    ts: v.number(),
  }).index("by_account_id", ["account_id"]),

  // -------------------------------------------------------------------------
  // rateLimits — internal helper (NOT a frozen contract). One row per
  // ip+minute-bucket, used by /beacon to cap requests per IP per minute.
  // -------------------------------------------------------------------------
  rateLimits: defineTable({
    key: v.string(), // `${ip}:${minuteBucket}`
    count: v.number(),
  }).index("by_key", ["key"]),

  // -------------------------------------------------------------------------
  // activity — NEW observability table (NOT a frozen contract). A fine-grained,
  // human-readable "minute activity" stream mirrored from the running Hermes
  // gateway log by scripts/log-stream.mjs → POST /pipelog. Unlike `traces`
  // (coarse QA-gate verdicts), this captures every Linkup query, browser QA
  // step, file write, wrangler deploy, pipeline transition, and error as it
  // happens. Rows are naturally ordered by _creationTime; pruneActivity keeps
  // the table bounded. This does NOT touch the frozen fleet/traces/events
  // contracts.
  //   ts        — event time, epoch ms (from the log line / now)
  //   account_id— best-effort extraction (sites/<id>, --project-name <id>, …)
  //   kind      — research | build | deploy | qa | tool | pipeline | error
  //   message   — concise human-readable line (truncated ~300 chars)
  // -------------------------------------------------------------------------
  activity: defineTable({
    ts: v.number(),
    account_id: v.optional(v.string()),
    kind: v.string(),
    message: v.string(),
  }).index("by_account_id", ["account_id"]),
});
