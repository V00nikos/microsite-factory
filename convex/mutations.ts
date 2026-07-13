import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { fleetStatus, stageValidator, eventType, verdictValidator } from "./schema";

// All writes are internalMutation on purpose: the ONLY write path is the
// authenticated HTTP actions in http.ts (CLAUDE.md rule 6). Nothing here is
// callable from a public Convex client without going through those actions.

const RATE_LIMIT_PER_MIN = 60; // sane cap: 60 beacon hits / IP / minute

// ---------------------------------------------------------------------------
// upsertFleet — insert or patch a fleet row keyed by account_id.
// account_id is the only required arg; everything else is optional so a
// partial stage-transition patch works. updated_at is epoch ms (the /fleet
// action coerces the pipeline's ISO8601 string before calling this).
// ---------------------------------------------------------------------------
export const upsertFleet = internalMutation({
  args: {
    account_id: v.string(),
    company: v.optional(v.string()),
    stage: v.optional(stageValidator),
    status: v.optional(fleetStatus),
    blocked_reason: v.optional(v.string()),
    cost_usd: v.optional(v.number()),
    url: v.optional(v.string()),
    updated_at: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.updated_at ?? Date.now();
    const existing = await ctx.db
      .query("fleet")
      .withIndex("by_account_id", (q) => q.eq("account_id", args.account_id))
      .unique();

    if (existing) {
      // Patch only the fields that were actually provided (skip undefined so we
      // never blow away a required field). Conditional spreads keep this a
      // correctly-typed Partial<fleet> once codegen has run.
      await ctx.db.patch(existing._id, {
        ...(args.company !== undefined ? { company: args.company } : {}),
        ...(args.stage !== undefined ? { stage: args.stage } : {}),
        ...(args.status !== undefined ? { status: args.status } : {}),
        ...(args.blocked_reason !== undefined
          ? { blocked_reason: args.blocked_reason }
          : {}),
        ...(args.cost_usd !== undefined ? { cost_usd: args.cost_usd } : {}),
        ...(args.url !== undefined ? { url: args.url } : {}),
        updated_at: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("fleet", {
      account_id: args.account_id,
      company: args.company ?? args.account_id,
      stage: args.stage ?? "research",
      status: args.status ?? "queued",
      blocked_reason: args.blocked_reason,
      cost_usd: args.cost_usd ?? 0,
      url: args.url,
      updated_at: now,
    });
  },
});

// ---------------------------------------------------------------------------
// insertTrace — append one trace row (mirror of the JSONL trace line).
// ---------------------------------------------------------------------------
export const insertTrace = internalMutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("traces", args);
  },
});

// ---------------------------------------------------------------------------
// insertEvent — thin standalone event insert (kept for reuse/testing).
// The /beacon path uses recordBeacon below, which is atomic; this is the
// bare insert with no validation/rate-limit.
// ---------------------------------------------------------------------------
export const insertEvent = internalMutation({
  args: {
    account_id: v.string(),
    type: eventType,
    ts: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("events", args);
  },
});

// ---------------------------------------------------------------------------
// recordBeacon — the /beacon transaction: account-existence check, per-IP
// rate limit, and event insert, ALL in one mutation so they can't race.
// Returns a { code } the HTTP action maps to an HTTP status.
//   429 -> over rate limit   404 -> unknown account   200 -> inserted
// Rate limit is checked FIRST (throttles floods even at unknown accounts).
// Bucket is derived from server Date.now(), never the client-supplied ts.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// deleteAccount — admin cleanup: remove a fleet row and all of its traces and
// events by account_id. Used to prune seed/placeholder accounts off the board.
// Run via: npx convex run mutations:deleteAccount '{"account_id":"..."}'
// ---------------------------------------------------------------------------
export const deleteAccount = internalMutation({
  args: { account_id: v.string() },
  returns: v.object({ fleet: v.number(), traces: v.number(), events: v.number() }),
  handler: async (ctx, args) => {
    const fleet = await ctx.db
      .query("fleet")
      .withIndex("by_account_id", (q) => q.eq("account_id", args.account_id))
      .collect();
    for (const r of fleet) await ctx.db.delete(r._id);
    const traces = await ctx.db
      .query("traces")
      .withIndex("by_account_id", (q) => q.eq("account_id", args.account_id))
      .collect();
    for (const t of traces) await ctx.db.delete(t._id);
    const events = await ctx.db
      .query("events")
      .withIndex("by_account_id", (q) => q.eq("account_id", args.account_id))
      .collect();
    for (const e of events) await ctx.db.delete(e._id);
    return { fleet: fleet.length, traces: traces.length, events: events.length };
  },
});

// ---------------------------------------------------------------------------
// insertActivity — append one row to the observability `activity` stream
// (mirrored from the Hermes gateway log by scripts/log-stream.mjs via
// POST /pipelog). message is hard-truncated to 300 chars so a runaway log line
// can never bloat a row. This is the ONLY write path for the activity table.
// ---------------------------------------------------------------------------
const ACTIVITY_MSG_MAX = 300;

export const insertActivity = internalMutation({
  args: {
    ts: v.number(),
    account_id: v.optional(v.string()),
    kind: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const message =
      args.message.length > ACTIVITY_MSG_MAX
        ? args.message.slice(0, ACTIVITY_MSG_MAX)
        : args.message;
    return await ctx.db.insert("activity", {
      ts: args.ts,
      account_id: args.account_id,
      kind: args.kind,
      message,
    });
  },
});

// ---------------------------------------------------------------------------
// pruneActivity — keep the activity table bounded: delete every row except the
// newest `keep` (default 500). Newest is by _creationTime (native insertion
// order). Safe to run repeatedly; a no-op once the table is small.
// Run via: npx convex run mutations:pruneActivity '{"keep":500}'
// ---------------------------------------------------------------------------
export const pruneActivity = internalMutation({
  args: { keep: v.optional(v.number()) },
  returns: v.object({ deleted: v.number(), kept: v.number() }),
  handler: async (ctx, args) => {
    const requested = Math.floor(args.keep ?? 500);
    const keep = Math.max(0, Number.isFinite(requested) ? requested : 500);

    // Newest-first, skip the first `keep`, delete the rest.
    const rows = await ctx.db.query("activity").order("desc").collect();
    let deleted = 0;
    for (let i = keep; i < rows.length; i++) {
      await ctx.db.delete(rows[i]._id);
      deleted += 1;
    }
    return { deleted, kept: Math.min(keep, rows.length) };
  },
});

export const recordBeacon = internalMutation({
  args: {
    account_id: v.string(),
    type: eventType,
    ts: v.number(),
    ip: v.string(),
  },
  returns: v.object({ code: v.number() }),
  handler: async (ctx, args) => {
    // 1) per-IP, per-minute rate limit
    const bucket = Math.floor(Date.now() / 60_000);
    const key = `${args.ip}:${bucket}`;
    const rl = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (rl) {
      if (rl.count >= RATE_LIMIT_PER_MIN) return { code: 429 };
      await ctx.db.patch(rl._id, { count: rl.count + 1 });
    } else {
      await ctx.db.insert("rateLimits", { key, count: 1 });
    }

    // 2) account must exist in fleet
    const fleetRow = await ctx.db
      .query("fleet")
      .withIndex("by_account_id", (q) => q.eq("account_id", args.account_id))
      .unique();
    if (!fleetRow) return { code: 404 };

    // 3) insert the anonymous event (3 fields only)
    await ctx.db.insert("events", {
      account_id: args.account_id,
      type: args.type,
      ts: args.ts,
    });
    return { code: 200 };
  },
});
