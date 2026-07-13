import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

// --- helpers ---------------------------------------------------------------

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

// Coerce an incoming timestamp to epoch ms. Accepts number (ms), ISO8601
// string, or missing -> now.
function toEpochMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const p = Date.parse(value);
    if (!Number.isNaN(p)) return p;
  }
  return Date.now();
}

// First hop of X-Forwarded-For (client IP), with CF fallback.
function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

// Shared-secret auth for /fleet and /trace (fails closed if env unset).
function authorized(request: Request): boolean {
  const provided = request.headers.get("x-factory-key");
  const expected = process.env.FACTORY_KEY;
  return !!expected && !!provided && provided === expected;
}

// --- POST /beacon -----------------------------------------------------------
// Public (no auth). Body: {a: account_id, t: type, d?: detail, ts}.
// Validates account exists (404), rate-limits per IP (429), inserts an event.
// `d` (detail) is accepted for wire compatibility but NOT persisted — the
// events table is frozen to the three anonymous fields (account_id, type, ts).
http.route({
  path: "/beacon",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: CORS })),
});

http.route({
  path: "/beacon",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: "invalid json" }, CORS);
    }

    const a = body?.a;
    const t = body?.t;
    if (typeof a !== "string" || a.length === 0) {
      return json(400, { error: "missing account_id (a)" }, CORS);
    }
    if (t !== "view" && t !== "scroll50" && t !== "cta") {
      return json(400, { error: "invalid type (t)" }, CORS);
    }

    const res = await ctx.runMutation(internal.mutations.recordBeacon, {
      account_id: a,
      type: t,
      ts: toEpochMs(body?.ts),
      ip: clientIp(request),
    });

    if (res.code === 429) return json(429, { error: "rate limited" }, CORS);
    if (res.code === 404) return json(404, { error: "unknown account" }, CORS);
    return json(200, { ok: true }, CORS);
  }),
});

// --- POST /fleet ------------------------------------------------------------
// Pipeline state upsert. Requires x-factory-key. Body = the fleet row JSON.
// updated_at (ISO8601 from the pipeline) is coerced to epoch ms.
http.route({
  path: "/fleet",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return json(401, { error: "unauthorized" });

    let body: any;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: "invalid json" });
    }

    if (typeof body?.account_id !== "string" || body.account_id.length === 0) {
      return json(400, { error: "missing account_id" });
    }

    const id = await ctx.runMutation(internal.mutations.upsertFleet, {
      account_id: body.account_id,
      company: typeof body.company === "string" ? body.company : undefined,
      stage: body.stage,
      status: body.status,
      blocked_reason:
        typeof body.blocked_reason === "string" ? body.blocked_reason : undefined,
      cost_usd: typeof body.cost_usd === "number" ? body.cost_usd : undefined,
      url: typeof body.url === "string" ? body.url : undefined,
      updated_at: body.updated_at !== undefined ? toEpochMs(body.updated_at) : undefined,
    });

    return json(200, { ok: true, id });
  }),
});

// --- POST /trace ------------------------------------------------------------
// Trace mirror from qa-reviewer. Requires x-factory-key. Body = trace line JSON.
http.route({
  path: "/trace",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return json(401, { error: "unauthorized" });

    let body: any;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: "invalid json" });
    }

    const id = await ctx.runMutation(internal.mutations.insertTrace, {
      trace_id: body.trace_id,
      ts: body.ts,
      account_id: body.account_id,
      stage: body.stage,
      input_ref: body.input_ref,
      output_ref: body.output_ref,
      verdict: body.verdict,
      rubric_version: body.rubric_version,
      model: body.model,
      cost_usd: body.cost_usd,
      latency_s: body.latency_s,
      retry_of: body.retry_of ?? null,
    });

    return json(200, { ok: true, id });
  }),
});

// --- POST /pipelog ----------------------------------------------------------
// Fine-grained agent activity from scripts/log-stream.mjs (the Hermes log
// tailer). Same shared-secret auth as /fleet and /trace. Body:
//   {ts?, account_id?, kind, message}
// ts is coerced to epoch ms (number/ISO8601/missing->now). kind & message are
// required strings; message is truncated to 300 chars inside insertActivity.
// Lightweight by design — no rate limit, no account-existence check.
http.route({
  path: "/pipelog",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return json(401, { error: "unauthorized" });

    let body: any;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: "invalid json" });
    }

    if (typeof body?.kind !== "string" || body.kind.length === 0) {
      return json(400, { error: "missing kind" });
    }
    if (typeof body?.message !== "string" || body.message.length === 0) {
      return json(400, { error: "missing message" });
    }

    const id = await ctx.runMutation(internal.mutations.insertActivity, {
      ts: toEpochMs(body?.ts),
      account_id:
        typeof body.account_id === "string" && body.account_id.length > 0
          ? body.account_id
          : undefined,
      kind: body.kind,
      message: body.message,
    });

    return json(200, { ok: true, id });
  }),
});

export default http;
