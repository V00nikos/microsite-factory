// Client -> Pages Function bridge.
//
// The browser POSTs UNSIGNED JSON to our own same-origin Function routes. The
// Function (functions/api/*.ts) computes the HMAC-SHA256 signature with the
// server-only WEBHOOK_HMAC_SECRET and forwards the signed request to Hermes.
// The secret NEVER touches client code.

import type { IntakeRow } from "./csv";
import type { Angle, Positioning } from "./types";

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  detail?: string;
}

async function post<T = unknown>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    let data: any = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: data?.error ?? `Request failed (${res.status})`,
        detail: data?.detail,
        data,
      };
    }
    return { ok: true, status: res.status, data };
  } catch (e) {
    // Network error — e.g. running plain `vite` (Functions not served) or Hermes
    // unreachable. Surface it; the board still reads live from Convex regardless.
    return {
      ok: false,
      status: 0,
      error: "network_unreachable",
      detail:
        e instanceof Error
          ? e.message
          : "Could not reach /api route. Use `npm run dev:pages` (wrangler) to run Functions locally.",
    };
  }
}

/** POST rows to run-factory. Payload shape is frozen. */
export function runFactory(rows: IntakeRow[]): Promise<ApiResult> {
  return post("/api/run-factory", { rows });
}

export interface RegeneratePayload {
  account_id: string;
  mode: "angle" | "instruction";
  angle?: Angle | "";
  instruction?: string;
}

export function regenerate(payload: RegeneratePayload): Promise<ApiResult> {
  return post("/api/regenerate", {
    account_id: payload.account_id,
    mode: payload.mode,
    angle: payload.angle ?? "",
    instruction: payload.instruction ?? "",
  });
}

export function updatePositioning(p: Positioning): Promise<ApiResult> {
  return post("/api/update-positioning", p);
}
