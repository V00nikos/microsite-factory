import { anyApi } from "convex/server";

/**
 * Loose Convex API surface.
 *
 * The `convex/` backend is authored in parallel, so `convex/_generated/api` may
 * not exist at build time. We use `anyApi` (untyped) so the app compiles now and
 * picks up real behavior at runtime. When the generated client lands, swap this
 * import for `import { api } from "../../convex/_generated/api"` — the call sites
 * below are the only place the function *names* are hard-coded.
 *
 * ACTUAL CONVEX FUNCTIONS (verified against convex/queries.ts):
 *
 *   query  queries.fleetBoard(): { accounts, totals, first_pass_qa }
 *     Reactive fleet board. Per-account: account_id, company, stage, status,
 *     blocked_reason, cost_usd, url, updated_at, event_counts{view,scroll50,cta},
 *     trace_count, first_pass_qa{by_stage, overall{first_pass,passed,rate}}.
 *     normalizeBoard() maps this backend shape into FleetBoard {rows, stats}.
 *   query  queries.accountDetail({account_id}): { fleet, event_counts, traces, first_pass_qa }
 *   query  queries.tracesForAccount({account_id}): trace[]  (oldest-first)
 *   query  queries.recentTraces({limit?}): trace[]  (newest-first, fleet-wide; default 30, max 100)
 *     Each row: trace_id, ts, account_id, stage, verdict{pass,failures}, retry_of,
 *     rubric_version, model. Powers the Fleet Board Activity log.
 *
 * The frontend never writes to Convex — all commands go through the Pages
 * Functions (see lib/factoryApi.ts). Convex is read-only here.
 */
export const api = anyApi as any;

/** Canonical function references, centralized so backend naming is easy to reconcile. */
export const fns = {
  fleetBoard: api.queries.fleetBoard,
  accountDetail: api.queries.accountDetail,
  tracesForAccount: api.queries.tracesForAccount,
  recentTraces: api.queries.recentTraces,
  recentActivity: api.queries.recentActivity,
} as const;
