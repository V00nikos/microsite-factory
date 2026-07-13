import {
  Component,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import css from "./ActivityPanel.module.css";
import { useFleet } from "../hooks/FleetProvider";
import { fns } from "../lib/convexApi";
import { convexClient } from "../convex";
import { ago, hostLabel } from "../lib/format";
import type { FleetRow } from "../lib/types";

/* ------------------------------------------------------------------ */
/*  Types — recentTraces rows (untyped anyApi, so we shape them here).  */
/* ------------------------------------------------------------------ */
interface TraceFailure {
  check?: string;
  detail?: string;
  severity?: string;
}
interface TraceRow {
  trace_id: string;
  ts: string;
  account_id: string;
  stage: string;
  verdict: { pass: boolean; failures: TraceFailure[] };
  retry_of: string | null;
  rubric_version: string;
  model: string;
}
/* recentActivity rows — the fine-grained Hermes stream (from log-stream.mjs). */
interface ActivityRow {
  _id?: string;
  ts: number; // epoch ms
  account_id?: string | null;
  kind: string; // research | build | deploy | qa | pipeline | tool | error
  message: string;
}

/* ------------------------------------------------------------------ */
/*  Time tracker — ONE wall-clock ticker (1s), lifted to the panel so    */
/*  every elapsed timer + relative label shares a single interval.       */
/*  The interval is cleared on unmount. Under prefers-reduced-motion the  */
/*  text still advances (no animation runs — the pulse keyframe is        */
/*  neutralized globally in global.css), so nothing here is gated.        */
/* ------------------------------------------------------------------ */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function tms(iso: string): number {
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

/** Precise, monotonic "2m 14s" duration. Clamps clock skew (now < from → 0s). */
function elapsed(fromMs: number, now: number): string {
  const s = Math.max(0, Math.floor((now - fromMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function firstLine(text: string | null | undefined): string {
  if (!text) return "";
  return text.split(/\r?\n/)[0].trim();
}

/* ------------------------------------------------------------------ */
/*  Error boundary — a not-yet-deployed/unreachable recentTraces query  */
/*  throws during render (same failure mode FleetProvider guards). We    */
/*  swallow it and fall back to a fleet-only feed (active/shipped/        */
/*  blocked rows still render — they don't depend on the trace query).   */
/* ------------------------------------------------------------------ */
class LogErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/* ------------------------------------------------------------------ */
/*  Unified live feed — merges two live sources into one time-ordered   */
/*  stream (newest first). In-flight accounts pin to the top as "live"   */
/*  rows with a ticking elapsed timer; completed QA verdicts, shipped    */
/*  URLs, and blocks flow below by timestamp.                            */
/* ------------------------------------------------------------------ */
const STAGE_LABEL: Record<string, string> = {
  research: "RSCH",
  build: "BUILD",
  deploy: "SHIP",
};
const STAGE_VERB: Record<string, string> = {
  research: "researching…",
  build: "building…",
  deploy: "deploying…",
};

type FeedEvent =
  | { kind: "active"; id: string; sortTime: number; row: FleetRow }
  | { kind: "shipped"; id: string; sortTime: number; row: FleetRow }
  | { kind: "blocked"; id: string; sortTime: number; row: FleetRow }
  | { kind: "trace"; id: string; sortTime: number; trace: TraceRow }
  | { kind: "activity"; id: string; sortTime: number; act: ActivityRow };

/* Fine-grained Hermes activity kinds → short label shown as a tag. */
const ACT_KIND_LABEL: Record<string, string> = {
  research: "RSCH",
  build: "BUILD",
  deploy: "SHIP",
  qa: "QA",
  pipeline: "PIPE",
  tool: "TOOL",
  error: "ERR",
};

/** Live/terminal states pulled straight from the fleet board (no trace query). */
function buildFleetEvents(rows: FleetRow[]): FeedEvent[] {
  const out: FeedEvent[] = [];
  for (const r of rows) {
    if (r.status === "in_progress") {
      out.push({ kind: "active", id: `active:${r.account_id}`, sortTime: r.updated_at, row: r });
    } else if (r.status === "shipped" && r.url) {
      out.push({ kind: "shipped", id: `shipped:${r.account_id}`, sortTime: r.updated_at, row: r });
    } else if (r.status === "blocked") {
      out.push({ kind: "blocked", id: `blocked:${r.account_id}`, sortTime: r.updated_at, row: r });
    }
  }
  return out;
}

/** Active rows pinned on top (they're happening now); everything else newest-first. */
function mergeEvents(fleet: FeedEvent[], traces: FeedEvent[]): FeedEvent[] {
  const active = fleet
    .filter((e) => e.kind === "active")
    .sort((a, b) => b.sortTime - a.sortTime);
  const rest = [...fleet.filter((e) => e.kind !== "active"), ...traces].sort(
    (a, b) => b.sortTime - a.sortTime
  );
  return [...active, ...rest].slice(0, 80);
}

function FeedRow({ event, now }: { event: FeedEvent; now: number }) {
  if (event.kind === "active") {
    const r = event.row;
    const verb = STAGE_VERB[r.stage] ?? `${r.stage}…`;
    return (
      <li className={`${css.logRow} ${css.activeRow}`}>
        <span className={`${css.logDot} ${css.live}`} aria-hidden="true" />
        <div className={css.logMain}>
          <div className={css.logTop}>
            <span className={css.logCompany} title={r.company}>
              {r.company}
            </span>
            <span className={css.liveTag}>live</span>
          </div>
          <div className={css.logVerdict}>
            <span className={css.verb}>{verb}</span>
          </div>
        </div>
        <span
          className={css.timer}
          aria-label={`running for ${elapsed(r.updated_at, now)}`}
        >
          {elapsed(r.updated_at, now)}
        </span>
      </li>
    );
  }

  if (event.kind === "shipped") {
    const r = event.row;
    return (
      <li className={css.logRow}>
        <span className={`${css.logDot} ${css.pass}`} aria-hidden="true" />
        <div className={css.logMain}>
          <div className={css.logTop}>
            <span className={css.logCompany} title={r.company}>
              {r.company}
            </span>
            <span className={css.logStage}>{STAGE_LABEL.deploy}</span>
          </div>
          <div className={css.logVerdict}>
            <span className={css.pass}>shipped</span>
            <a
              className={css.shipLink}
              href={r.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              title={r.url ?? undefined}
            >
              {hostLabel(r.url)}
            </a>
          </div>
        </div>
        <time
          className={css.logTime}
          dateTime={new Date(r.updated_at).toISOString()}
        >
          {ago(r.updated_at, now)}
        </time>
      </li>
    );
  }

  if (event.kind === "blocked") {
    const r = event.row;
    const reason = firstLine(r.blocked_reason) || "blocked — no reason recorded";
    return (
      <li className={css.logRow}>
        <span className={`${css.logDot} ${css.block}`} aria-hidden="true" />
        <div className={css.logMain}>
          <div className={css.logTop}>
            <span className={css.logCompany} title={r.company}>
              {r.company}
            </span>
            <span className={css.logStage}>{STAGE_LABEL[r.stage] ?? r.stage}</span>
            <span className={css.block}>BLOCK</span>
          </div>
          <div className={css.logVerdict}>
            <span className={css.blockReason} title={r.blocked_reason ?? undefined}>
              {reason}
            </span>
          </div>
        </div>
        <time
          className={css.logTime}
          dateTime={new Date(r.updated_at).toISOString()}
        >
          {ago(r.updated_at, now)}
        </time>
      </li>
    );
  }

  if (event.kind === "activity") {
    const a = event.act;
    const isErr = a.kind === "error";
    return (
      <li className={css.logRow}>
        <span
          className={`${css.logDot} ${isErr ? css.block : css.pass}`}
          aria-hidden="true"
        />
        <div className={css.logMain}>
          <div className={css.logTop}>
            <span className={css.logStage}>{ACT_KIND_LABEL[a.kind] ?? a.kind.toUpperCase()}</span>
            {a.account_id && (
              <span className={css.logAcct} title={a.account_id}>
                {a.account_id}
              </span>
            )}
          </div>
          <div className={css.logVerdict}>
            <span className={isErr ? css.blockReason : css.verb} title={a.message}>
              {a.message}
            </span>
          </div>
        </div>
        <time className={css.logTime} dateTime={new Date(a.ts).toISOString()}>
          {ago(a.ts, now)}
        </time>
      </li>
    );
  }

  // kind === "trace"
  const t = event.trace;
  const pass = t.verdict?.pass === true;
  const firstCheck = t.verdict?.failures?.[0]?.check;
  return (
    <li className={css.logRow}>
      <span className={`${css.logDot} ${pass ? css.pass : css.block}`} aria-hidden="true" />
      <div className={css.logMain}>
        <div className={css.logTop}>
          <span className={css.logAcct} title={t.account_id}>
            {t.account_id}
          </span>
          <span className={css.logStage}>{STAGE_LABEL[t.stage] ?? t.stage}</span>
          {t.retry_of && <span className={css.retry}>retry</span>}
        </div>
        <div className={css.logVerdict}>
          {pass ? (
            <span className={css.pass}>PASS</span>
          ) : (
            <>
              <span className={css.block}>BLOCK</span>
              {firstCheck && (
                <span className={css.check} title={firstCheck}>
                  {firstCheck}
                </span>
              )}
            </>
          )}
        </div>
      </div>
      <time className={css.logTime} dateTime={t.ts} title={t.ts}>
        {ago(tms(t.ts), now)}
      </time>
    </li>
  );
}

/** Presentational: merges + renders, owns the loading/empty states. */
function FeedBody({
  fleetEvents,
  traceEvents,
  tracesLoading,
  now,
}: {
  fleetEvents: FeedEvent[];
  traceEvents: FeedEvent[];
  tracesLoading: boolean;
  now: number;
}) {
  const events = useMemo(
    () => mergeEvents(fleetEvents, traceEvents),
    [fleetEvents, traceEvents]
  );

  if (tracesLoading && fleetEvents.length === 0) {
    return <div className={`${css.empty} ${css.emptyMono}`}>connecting…</div>;
  }
  if (events.length === 0) {
    return <div className={css.empty}>Waiting for the first pipeline event…</div>;
  }
  return (
    <ul className={css.feed} aria-label="Live pipeline activity, newest first">
      {events.map((e) => (
        <FeedRow key={e.id} event={e} now={now} />
      ))}
    </ul>
  );
}

/** Runs the (throwable) recentTraces query and reports the newest trace ts up. */
function FeedWithTraces({
  fleetEvents,
  now,
  onLatestTrace,
}: {
  fleetEvents: FeedEvent[];
  now: number;
  onLatestTrace: (ms: number | null) => void;
}) {
  const raw = useQuery(fns.recentTraces, { limit: 30 });
  const traces = (raw ?? []) as TraceRow[];
  // Fine-grained Hermes stream (minute activity from the log tailer).
  const rawAct = useQuery(fns.recentActivity, { limit: 60 });
  const activity = (rawAct ?? []) as ActivityRow[];

  const traceEvents = useMemo<FeedEvent[]>(
    () => [
      ...traces.map((t) => ({
        kind: "trace" as const,
        id: t.trace_id,
        sortTime: tms(t.ts),
        trace: t,
      })),
      ...activity.map((a, i) => ({
        kind: "activity" as const,
        id: a._id ?? `act:${a.ts}:${i}`,
        sortTime: a.ts,
        act: a,
      })),
    ],
    [traces, activity]
  );

  const newestTrace = useMemo(() => {
    let m = 0;
    for (const t of traces) {
      const v = tms(t.ts);
      if (v > m) m = v;
    }
    for (const a of activity) if (a.ts > m) m = a.ts;
    return m || null;
  }, [traces, activity]);

  useEffect(() => {
    onLatestTrace(newestTrace);
  }, [newestTrace, onLatestTrace]);

  return (
    <FeedBody
      fleetEvents={fleetEvents}
      traceEvents={traceEvents}
      tracesLoading={raw === undefined && rawAct === undefined}
      now={now}
    />
  );
}

function LiveFeed({
  rows,
  now,
  canQuery,
  onLatestTrace,
}: {
  rows: FleetRow[];
  now: number;
  canQuery: boolean;
  onLatestTrace: (ms: number | null) => void;
}) {
  const fleetEvents = useMemo(() => buildFleetEvents(rows), [rows]);

  // No Convex client → no trace query; show the fleet-derived feed alone.
  if (!canQuery) {
    return (
      <FeedBody fleetEvents={fleetEvents} traceEvents={[]} tracesLoading={false} now={now} />
    );
  }

  // If the trace query throws (not deployed yet), fall back to fleet-only.
  return (
    <LogErrorBoundary
      fallback={
        <FeedBody fleetEvents={fleetEvents} traceEvents={[]} tracesLoading={false} now={now} />
      }
    >
      <FeedWithTraces fleetEvents={fleetEvents} now={now} onLatestTrace={onLatestTrace} />
    </LogErrorBoundary>
  );
}

/* ------------------------------------------------------------------ */
/*  Queue — pending work derived from the fleet board ("what's left").  */
/*  Kept alongside the feed: it owns full blocked-reason visibility and  */
/*  the click-through to each account's preview.                         */
/* ------------------------------------------------------------------ */
type QueueKind = "attention" | "running" | "waiting";

const GROUPS: { kind: QueueKind; status: FleetRow["status"]; label: string }[] = [
  { kind: "attention", status: "blocked", label: "Needs attention" },
  { kind: "running", status: "in_progress", label: "Running now" },
  { kind: "waiting", status: "queued", label: "Waiting" },
];

function QueueItem({ row, kind }: { row: FleetRow; kind: QueueKind }) {
  const navigate = useNavigate();
  const sub =
    kind === "attention"
      ? firstLine(row.blocked_reason) || "blocked — no reason recorded"
      : kind === "running"
        ? "running now"
        : "waiting in queue";
  return (
    <button
      className={css.qItem}
      onClick={() => navigate(`/preview/${encodeURIComponent(row.account_id)}`)}
      aria-label={`${row.company} — ${GROUPS.find((g) => g.kind === kind)?.label}. Open preview.`}
    >
      <span className={`${css.qBar} ${css[kind]}`} aria-hidden="true" />
      <span className={css.qBody}>
        <span className={css.qCompany}>{row.company}</span>
        <span className={`${css.qSub} ${kind === "attention" ? css.reason : ""}`}>{sub}</span>
      </span>
      {kind === "running" && <span className={css.qStage}>{STAGE_LABEL[row.stage] ?? row.stage}</span>}
    </button>
  );
}

function QueueSection({ rows }: { rows: FleetRow[] }) {
  const groups = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        items: rows.filter((r) => r.status === g.status),
      })),
    [rows]
  );

  const running = groups.find((g) => g.kind === "running")?.items.length ?? 0;
  const waiting = groups.find((g) => g.kind === "waiting")?.items.length ?? 0;
  const attention = groups.find((g) => g.kind === "attention")?.items.length ?? 0;
  const pending = running + waiting + attention;

  return (
    <section className={css.section} aria-labelledby="activity-queue">
      <div className={css.sectionHead}>
        <h3 id="activity-queue">Queue</h3>
        <span className={css.sectionSub}>what needs to be done</span>
      </div>

      <div className={css.chips} role="group" aria-label="Pending counts by state">
        <span className={`${css.chip} ${css.running}`}>
          <i aria-hidden="true" />
          <b>{running}</b> running
        </span>
        <span className={`${css.chip} ${css.waiting}`}>
          <i aria-hidden="true" />
          <b>{waiting}</b> waiting
        </span>
        <span className={`${css.chip} ${css.attention}`}>
          <i aria-hidden="true" />
          <b>{attention}</b> blocked
        </span>
      </div>

      {pending === 0 ? (
        <div className={css.empty}>Nothing pending — fleet is clear.</div>
      ) : (
        <div className={css.queueScroll}>
          {groups
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <div className={css.group} key={g.kind}>
                <div className={css.groupLabel}>
                  {g.label} · {g.items.length}
                </div>
                {g.items.map((row) => (
                  <QueueItem key={row.account_id} row={row} kind={g.kind} />
                ))}
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  ActivityPanel — the right-rail (stacks under the board on narrow).  */
/* ------------------------------------------------------------------ */
export function ActivityPanel() {
  const { board } = useFleet();
  // ConvexProvider is mounted iff a client exists; only then is useQuery safe.
  const canQuery = convexClient != null;

  // Single 1s ticker for the whole panel (elapsed timers + relative labels).
  const now = useNow(1000);
  const [latestTraceMs, setLatestTraceMs] = useState<number | null>(null);

  // Newest fleet activity — a faithful "last event" clock even before traces.
  const fleetNewest = useMemo(() => {
    let m = 0;
    for (const r of board.rows) if (r.updated_at > m) m = r.updated_at;
    return m || null;
  }, [board.rows]);

  const lastEventMs = Math.max(fleetNewest ?? 0, latestTraceMs ?? 0) || null;

  return (
    <aside className={css.panel} aria-label="Activity">
      <div className={css.head}>
        <h2>Activity</h2>
        <div className={css.headMeta}>
          {lastEventMs != null && (
            <span className={css.lastEvent}>last event · {ago(lastEventMs, now)}</span>
          )}
          <span className={`${css.headLive} ${canQuery ? "" : css.stale}`}>
            <i aria-hidden="true" />
            {canQuery ? "live" : "idle"}
          </span>
        </div>
      </div>

      <section className={css.section} aria-labelledby="activity-log">
        <div className={css.sectionHead}>
          <h3 id="activity-log">Live feed</h3>
          <span className={css.sectionSub}>what's happening now</span>
        </div>
        <LiveFeed
          rows={board.rows}
          now={now}
          canQuery={canQuery}
          onLatestTrace={setLatestTraceMs}
        />
      </section>

      <QueueSection rows={board.rows} />
    </aside>
  );
}
