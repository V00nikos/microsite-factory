#!/usr/bin/env node
// ---------------------------------------------------------------------------
// log-stream.mjs — mirror the running Hermes gateway's fine-grained activity
// into Convex so the Microsite Factory console can show a live "minute
// activity" feed of what Hermes is doing right now.
//
// It tails ~/.hermes/logs/agent.log (start near the end, then stream appends
// via a poll-the-size/read-new-bytes loop — NOT `tail -F`), classifies each
// NEW line into a concise human-readable activity, and POSTs it to
//   ${CONVEX_SITE_URL}/pipelog   (x-factory-key header, same auth as /fleet).
//
// Design notes:
//   * Interesting-line-only: most log lines are skipped (OpenAI client churn,
//     vision base64 chatter, housekeeping, read_file/search_files, etc.).
//   * At most ~1 POST/sec (a drain timer), consecutive duplicates coalesced.
//   * account_id is extracted best-effort from sites/<id> or --project-name.
//   * Robust: an unparseable line is skipped, never fatal; file rotation /
//     truncation resets the read position; missing file is retried.
//
// Run continuously (see the deploy note at the bottom of this file):
//   node scripts/log-stream.mjs
// ---------------------------------------------------------------------------

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// --- config ----------------------------------------------------------------

const HOME = os.homedir();
const LOG_FILE = process.env.HERMES_AGENT_LOG || path.join(HOME, ".hermes", "logs", "agent.log");
const POLL_MS = 1000; // how often we check the file for new bytes
const DRAIN_MS = 1000; // min gap between POSTs (~1/sec throttle)
const QUEUE_MAX = 200; // cap pending activities; drop oldest beyond this
const KEEPALIVE_MS = 25_000; // emit a sparse "still working" tick if idle this long
const POST_TIMEOUT_MS = 10_000;

// --- env loading (mirror factory-report.sh precedence) ----------------------
// process env  ->  ~/.hermes/.env  ->  ~/microsite-factory/.env
function loadKey(key) {
  if (process.env[key]) return process.env[key];
  const files = [
    path.join(HOME, ".hermes", ".env"),
    path.join(HOME, "microsite-factory", ".env"),
  ];
  for (const f of files) {
    try {
      const txt = fs.readFileSync(f, "utf8");
      for (const raw of txt.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        if (line.startsWith(key + "=")) {
          const val = line.slice(key.length + 1).trim();
          if (val) return val;
        }
      }
    } catch {
      /* file missing / unreadable — try next */
    }
  }
  return undefined;
}

const CONVEX_SITE_URL = (loadKey("CONVEX_SITE_URL") || "").replace(/\/+$/, "");
const FACTORY_KEY = loadKey("FACTORY_KEY") || "";

if (!CONVEX_SITE_URL) {
  console.error("[log-stream] CONVEX_SITE_URL not set (checked env, ~/.hermes/.env, repo .env) — exiting");
  process.exit(1);
}
if (!FACTORY_KEY) {
  console.error("[log-stream] FACTORY_KEY not set (checked env, ~/.hermes/.env, repo .env) — exiting");
  process.exit(1);
}
const PIPELOG_URL = `${CONVEX_SITE_URL}/pipelog`;

// --- helpers ----------------------------------------------------------------

// Best-effort account_id from a line: sites/<id> or --project-name <id>.
function extractAccountId(line) {
  let m = line.match(/--project-name[= ]+([A-Za-z0-9][A-Za-z0-9_.-]*)/);
  if (m) return trimId(m[1]);
  m = line.match(/sites\/([A-Za-z0-9][A-Za-z0-9_.-]*)/);
  if (m) return trimId(m[1]);
  return undefined;
}
function trimId(id) {
  // strip trailing separators / punctuation the regex may have swept up
  return id.replace(/[.\-_]+$/, "") || id;
}

// Grab the free-text tail of a "[webhook] Response for <chat>: <text>" line.
function webhookResponseText(line) {
  const idx = line.indexOf("] Response for ");
  if (idx === -1) return "";
  const after = line.slice(idx + "] Response for ".length);
  const colon = after.indexOf(": ");
  return colon === -1 ? after.trim() : after.slice(colon + 2).trim();
}

function collapse(s, max = 240) {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max) : one;
}

// Parse the leading "YYYY-MM-DD HH:MM:SS,mmm" timestamp -> epoch ms (local).
function parseTs(line) {
  const m = line.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!m) return Date.now();
  const [, Y, Mo, D, H, Mi, S, ms] = m;
  const t = new Date(+Y, +Mo - 1, +D, +H, +Mi, +S, +ms).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

// --- classifier -------------------------------------------------------------
// Map a raw log line to at most one activity {kind, message} (account_id and
// ts are attached by the caller). Returns null for uninteresting lines.
// Rules are ordered most-specific -> least-specific; first match wins.
function classify(line) {
  const l = line;
  const low = l.toLowerCase();

  // ---- webhook lifecycle (pipeline / error) ----
  if (l.includes("[webhook] Response for ")) {
    const text = webhookResponseText(l);
    const isErr =
      /❌|🚫|non-retryable|\bblocked\b|\berror\b|\bfailed\b|\bcannot\b|http 4\d\d|http 5\d\d/i.test(text);
    if (!text) return null;
    if (isErr) return { kind: "error", message: `run-factory: ${collapse(text)}` };
    return { kind: "pipeline", message: `run-factory: ${collapse(text)}` };
  }
  if (l.includes("inbound message:") && (l.includes("user=run-factory") || l.includes("platform=webhook"))) {
    return { kind: "pipeline", message: "run-factory received a new request" };
  }
  if (l.includes("[webhook] POST ") && l.includes("route=run-factory")) {
    return { kind: "pipeline", message: "run-factory webhook received" };
  }

  // ---- research (Linkup) ----
  if (low.includes("linkup-research") || low.includes("api.linkup.so") || low.includes("linkup")) {
    if (/timed out|error|failed|exit_code": 1/i.test(l)) {
      return { kind: "research", message: "research query failed (Linkup timed out or errored)" };
    }
    return { kind: "research", message: "ran a research query (Linkup)" };
  }

  // ---- deploy (wrangler / cloudflare pages) ----
  if (low.includes("wrangler") || low.includes("pages deploy") || l.includes("--project-name")) {
    const acct = extractAccountId(l);
    if (/error|failed|✖|exit_code": 1/i.test(l)) {
      return { kind: "deploy", message: acct ? `deploy of ${acct} failed` : "a Cloudflare deploy failed" };
    }
    return {
      kind: "deploy",
      message: acct ? `deploying ${acct} to Cloudflare` : "deploying a site to Cloudflare",
    };
  }

  // ---- pipeline state mirror (factory-report.sh) ----
  if (low.includes("factory-report")) {
    return { kind: "pipeline", message: "wrote fleet/trace state to Convex" };
  }

  // ---- QA: browser + screenshot vision ----
  if (l.includes("browser_navigate") || l.includes("browser_screenshot")) {
    if (/error|failed|doesn't exist|blocked/i.test(l)) {
      return { kind: "qa", message: "QA: browser step failed (headless browser unavailable?)" };
    }
    return { kind: "qa", message: "QA: loaded a page in the browser" };
  }
  if (l.includes("Analyzing image:")) {
    return { kind: "qa", message: "QA: analyzing a rendered screenshot" };
  }
  if (l.includes("tool vision_analyze completed")) {
    return { kind: "qa", message: "QA: screenshot analysis complete" };
  }

  // ---- build: file writes / patches (HTML + assets) ----
  if (l.includes("tool write_file completed")) {
    return { kind: "build", message: "wrote a file (HTML / asset)" };
  }
  if (l.includes("tool patch completed")) {
    return { kind: "build", message: "edited a file (patch)" };
  }

  // ---- terminal errors (surface the blocking cause) ----
  if (l.includes("Tool terminal returned error")) {
    if (/convex_deploy_key/i.test(l)) {
      return { kind: "error", message: "a command failed: CONVEX_DEPLOY_KEY not set" };
    }
    if (/playwright|headless_shell|chromium/i.test(l)) {
      return { kind: "qa", message: "QA: headless browser not installed" };
    }
    if (/blocked: user denied/i.test(l)) {
      return { kind: "error", message: "a command was blocked (user denied)" };
    }
    return { kind: "error", message: "a terminal command failed" };
  }

  // ---- generic terminal command (low-signal tool tick) ----
  if (l.includes("tool terminal completed")) {
    return { kind: "tool", message: "ran a terminal command" };
  }

  return null; // uninteresting
}

// --- outbound queue + throttled sender --------------------------------------

const queue = [];
let lastQueuedKey = null;
let lastEmit = Date.now();

function keyOf(a) {
  return `${a.kind}|${a.message}|${a.account_id || ""}`;
}

function enqueue(activity) {
  const k = keyOf(activity);
  // coalesce consecutive duplicates
  if (k === lastQueuedKey) return;
  lastQueuedKey = k;
  queue.push(activity);
  // bound the backlog: drop oldest if we somehow fall far behind
  while (queue.length > QUEUE_MAX) queue.shift();
}

async function post(activity) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    const res = await fetch(PIPELOG_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-factory-key": FACTORY_KEY,
      },
      body: JSON.stringify(activity),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[log-stream] POST ${activity.kind} -> HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`[log-stream] POST failed: ${err?.message || err}`);
  } finally {
    clearTimeout(timer);
  }
}

// drain at most one item per DRAIN_MS
setInterval(() => {
  const a = queue.shift();
  if (!a) return;
  lastEmit = Date.now();
  post(a); // fire-and-forget; failures are logged, never fatal
}, DRAIN_MS).unref?.();

// sparse keep-alive: if nothing has been emitted for a while but the log is
// still advancing (API calls seen), show a "still working" tick.
let sawApiCallSinceKeepalive = false;
setInterval(() => {
  if (sawApiCallSinceKeepalive && Date.now() - lastEmit > KEEPALIVE_MS && queue.length === 0) {
    enqueue({ ts: Date.now(), kind: "pipeline", message: "Hermes is still working…" });
    sawApiCallSinceKeepalive = false;
  }
}, KEEPALIVE_MS).unref?.();

// --- line handling ----------------------------------------------------------

function handleLine(line) {
  try {
    if (!line) return;
    // cheap keep-alive signal (does NOT itself emit an activity)
    if (line.includes("conversation_loop: API call #")) {
      sawApiCallSinceKeepalive = true;
      return;
    }
    const hit = classify(line);
    if (!hit) return;
    enqueue({
      ts: parseTs(line),
      account_id: extractAccountId(line),
      kind: hit.kind,
      message: hit.message,
    });
  } catch (err) {
    // never let one bad line kill the tailer
    console.error(`[log-stream] line parse error: ${err?.message || err}`);
  }
}

// --- file tailer (poll size, read new bytes) --------------------------------

let pos = 0; // byte offset we've consumed up to
let leftover = ""; // partial trailing line carried between reads
let started = false;

async function tick() {
  let stat;
  try {
    stat = await fsp.stat(LOG_FILE);
  } catch {
    // file missing (not created yet / rotated away) — reset and wait
    pos = 0;
    leftover = "";
    return;
  }

  if (!started) {
    // start near the END so we only stream fresh appends, not the backlog
    pos = stat.size;
    started = true;
    return;
  }

  if (stat.size < pos) {
    // truncated or rotated — restart from the top of the new file
    pos = 0;
    leftover = "";
  }
  if (stat.size <= pos) return; // nothing new

  let fh;
  try {
    fh = await fsp.open(LOG_FILE, "r");
    const len = stat.size - pos;
    const buf = Buffer.allocUnsafe(len);
    const { bytesRead } = await fh.read(buf, 0, len, pos);
    pos += bytesRead;
    const chunk = leftover + buf.toString("utf8", 0, bytesRead);
    const lines = chunk.split("\n");
    leftover = lines.pop() ?? ""; // last piece may be incomplete
    for (const line of lines) handleLine(line);
  } catch (err) {
    console.error(`[log-stream] read error: ${err?.message || err}`);
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

// keep the poll loop alive even if a tick throws
async function loop() {
  try {
    await tick();
  } catch (err) {
    console.error(`[log-stream] tick error: ${err?.message || err}`);
  } finally {
    setTimeout(loop, POLL_MS);
  }
}

// --- guardrails: never crash the process -----------------------------------
process.on("uncaughtException", (err) => {
  console.error(`[log-stream] uncaughtException: ${err?.stack || err}`);
});
process.on("unhandledRejection", (err) => {
  console.error(`[log-stream] unhandledRejection: ${err?.message || err}`);
});

console.error(
  `[log-stream] tailing ${LOG_FILE} -> ${PIPELOG_URL} (poll ${POLL_MS}ms, <=1 POST/${DRAIN_MS}ms)`,
);
loop();
