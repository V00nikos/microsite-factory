// Shared server-side logic for the Microsite Factory Pages Functions.
//
// Files/dirs beginning with "_" are IGNORED by Cloudflare Pages routing, so this
// module is safe to import from the route handlers without exposing a route.
//
// SECURITY: WEBHOOK_HMAC_SECRET lives ONLY in the Function environment. The
// browser sends UNSIGNED JSON to these routes; we sign the RAW body here and
// forward it to Hermes. The secret is never in client code or any VITE_ var.

export interface Env {
  /** HMAC key shared with Hermes. Server-only. Never a VITE_ var. */
  WEBHOOK_HMAC_SECRET: string;
  /** Base URL of the Hermes webhook receiver, e.g. https://hermes.example.dev/webhooks */
  HERMES_WEBHOOK_BASE?: string;
  /** Optional per-webhook overrides (take precedence over the base + name). */
  HERMES_RUN_FACTORY_URL?: string;
  HERMES_REGENERATE_URL?: string;
  HERMES_UPDATE_POSITIONING_URL?: string;
}

// Hermes' generic HMAC scheme (verified against gateway/platforms/webhook.py):
//   V1 (used here): header "X-Webhook-Signature" = <hex HMAC-SHA256 of the raw body>,
//                   BARE hex — no "sha256=" prefix (that prefix is GitHub's X-Hub-Signature-256).
// Hardening path (V2, replay-protected): send "X-Webhook-Signature-V2" = hex HMAC-SHA256
//   of "<unixSeconds>.<body>" plus "X-Webhook-Timestamp: <unixSeconds>"; Hermes accepts
//   V2 within a 300s window. Flip SIGN_V2 to true to use it (test-webhooks.sh + docs are V1).
export const SIGNATURE_HEADER = "X-Webhook-Signature";

/**
 * digest = HMAC-SHA256(rawRequestBody, WEBHOOK_HMAC_SECRET) as lowercase hex.
 * The signed bytes are the EXACT raw JSON body forwarded byte-for-byte, so Hermes
 * verifies over the raw body it receives, before JSON parsing.
 */
export async function hmacHex(secret: string, raw: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(raw));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function resolveTarget(env: Env, name: string, override?: string): string | null {
  if (override && override.trim()) return override.trim();
  if (env.HERMES_WEBHOOK_BASE && env.HERMES_WEBHOOK_BASE.trim()) {
    return env.HERMES_WEBHOOK_BASE.trim().replace(/\/$/, "") + "/" + name;
  }
  return null;
}

/**
 * Sign the raw body and forward it to Hermes, then proxy Hermes's response back
 * to the browser. On upstream failure returns 502.
 */
export async function signAndForward(
  env: Env,
  name: string,
  raw: string,
  override?: string
): Promise<Response> {
  if (!env.WEBHOOK_HMAC_SECRET) {
    return json({ error: "server_misconfigured", detail: "WEBHOOK_HMAC_SECRET is not set" }, 500);
  }
  const target = resolveTarget(env, name, override);
  if (!target) {
    return json(
      { error: "server_misconfigured", detail: "No HERMES_WEBHOOK_BASE (or per-webhook URL) set" },
      500
    );
  }

  const digest = await hmacHex(env.WEBHOOK_HMAC_SECRET, raw);

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SIGNATURE_HEADER]: digest,
      },
      body: raw,
      signal: AbortSignal.timeout(15000),
    });

    const body = await upstream.text();
    // Proxy status + body; normalize content-type to JSON-ish passthrough.
    return new Response(body || JSON.stringify({ ok: upstream.ok, status: upstream.status }), {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      },
    });
  } catch (e) {
    return json(
      {
        error: "hermes_unreachable",
        detail: e instanceof Error ? e.message : "forward failed",
      },
      502
    );
  }
}

/** Parse the raw body as JSON; returns [payload, null] or [null, errorResponse]. */
export async function readJson(
  request: Request
): Promise<[any, null] | [null, Response]> {
  const raw = await request.text();
  if (!raw) return [null, json({ error: "empty_body" }, 400)];
  try {
    return [{ raw, data: JSON.parse(raw) }, null];
  } catch {
    return [null, json({ error: "invalid_json" }, 400)];
  }
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
