import type {
  FirstPassQa,
  FleetBoard,
  FleetRow,
  FleetStats,
  FleetStatus,
  Stage,
  StageRate,
} from "./types";

const STAGES: Stage[] = ["research", "build", "deploy"];

const EMPTY_COUNTS: Record<FleetStatus, number> = {
  queued: 0,
  in_progress: 0,
  blocked: 0,
  shipped: 0,
};

function emptyStageRates(): Record<Stage, StageRate> {
  return {
    research: { first_pass: 0, passed: 0, rate: null },
    build: { first_pass: 0, passed: 0, rate: null },
    deploy: { first_pass: 0, passed: 0, rate: null },
  };
}

function finalizeRates(by: Record<Stage, StageRate>): Record<Stage, StageRate> {
  for (const s of STAGES) {
    const b = by[s];
    b.rate = b.first_pass > 0 ? b.passed / b.first_pass : null;
  }
  return by;
}

export function emptyBoard(): FleetBoard {
  return {
    rows: [],
    stats: {
      first_pass_qa_rate: 0,
      qa_first_pass: 0,
      qa_total: 0,
      qa_by_stage: emptyStageRates(),
      total_cost_usd: 0,
      counts: { ...EMPTY_COUNTS },
      events: { view: 0, scroll50: 0, cta: 0 },
    },
  };
}

function computeStats(rows: FleetRow[]): FleetStats {
  const counts = { ...EMPTY_COUNTS };
  const events = { view: 0, scroll50: 0, cta: 0 };
  const qa_by_stage = emptyStageRates();
  let total_cost_usd = 0;
  let qa_first_pass = 0;
  let qa_total = 0;

  for (const r of rows) {
    if (r.status in counts) counts[r.status] += 1;
    total_cost_usd += r.cost_usd || 0;
    if (r.events) {
      events.view += r.events.view || 0;
      events.scroll50 += r.events.scroll50 || 0;
      events.cta += r.events.cta || 0;
    }
    if (r.qa) {
      qa_first_pass += r.qa.first_pass || 0;
      qa_total += r.qa.total || 0;
    }
    // Aggregate per-account stage tallies (present on backend + demo rows).
    const bs = r.first_pass_qa?.by_stage;
    if (bs) {
      for (const s of STAGES) {
        const src = bs[s];
        if (!src) continue;
        qa_by_stage[s].first_pass += src.first_pass || 0;
        qa_by_stage[s].passed += src.passed || 0;
      }
    }
  }

  return {
    first_pass_qa_rate: qa_total > 0 ? qa_first_pass / qa_total : 0,
    qa_first_pass,
    qa_total,
    qa_by_stage: finalizeRates(qa_by_stage),
    total_cost_usd,
    counts,
    events,
  };
}

/**
 * Map the backend's fleetBoard() output ({accounts, totals, first_pass_qa}) into
 * the frontend's {rows, stats} shape. Backend field names differ: event_counts →
 * events; per-account first_pass_qa.overall{passed,first_pass} → qa{first_pass,total}.
 * The full first_pass_qa (with by_stage) is preserved on each row; the fleet-wide
 * first_pass_qa.by_stage becomes stats.qa_by_stage (authoritative).
 */
function fromBackend(obj: any): { rows: FleetRow[]; stats: Partial<FleetStats> } {
  const rows: FleetRow[] = (obj.accounts as any[]).map((a) => {
    const fpq = a.first_pass_qa as FirstPassQa | undefined;
    const overall = fpq?.overall;
    return {
      ...a,
      events: a.event_counts ?? a.events,
      first_pass_qa: fpq ?? a.first_pass_qa ?? null,
      qa: overall ? { first_pass: overall.passed ?? 0, total: overall.first_pass ?? 0 } : a.qa,
    } as FleetRow;
  });
  const t = obj.totals ?? {};
  const fp = obj.first_pass_qa as FirstPassQa | undefined;
  const stats: Partial<FleetStats> = {
    total_cost_usd: t.cost_usd ?? 0,
    counts: {
      queued: t.queued ?? 0,
      in_progress: t.in_progress ?? 0,
      blocked: t.blocked ?? 0,
      shipped: t.shipped ?? 0,
    },
    events: t.events ?? { view: 0, scroll50: 0, cta: 0 },
  };
  if (fp?.overall) {
    stats.first_pass_qa_rate = fp.overall.rate ?? 0;
    stats.qa_first_pass = fp.overall.passed ?? 0;
    stats.qa_total = fp.overall.first_pass ?? 0;
  }
  if (fp?.by_stage) {
    const by = emptyStageRates();
    for (const s of STAGES) {
      const src = fp.by_stage[s];
      if (src) by[s] = { first_pass: src.first_pass ?? 0, passed: src.passed ?? 0, rate: src.rate ?? null };
    }
    stats.qa_by_stage = by;
  }
  return { rows, stats };
}

/**
 * Accept whatever the `fleetBoard` query returns and normalize to FleetBoard.
 * Supports: the backend shape ({accounts, totals, first_pass_qa}), the frontend
 * shape ({rows, stats}), a bare FleetRow[], or undefined/null. Server-provided
 * stats win for the QA rate (the backend has the authoritative trace tally);
 * otherwise stats are derived from rows.
 */
export function normalizeBoard(raw: unknown): FleetBoard {
  if (raw == null) return emptyBoard();

  let rows: FleetRow[] = [];
  let provided: Partial<FleetStats> | undefined;

  if (Array.isArray(raw)) {
    rows = raw as FleetRow[];
  } else if (typeof raw === "object") {
    const obj = raw as any;
    if (Array.isArray(obj.accounts)) {
      const mapped = fromBackend(obj);
      rows = mapped.rows;
      provided = mapped.stats;
    } else {
      if (Array.isArray(obj.rows)) rows = obj.rows as FleetRow[];
      if (obj.stats && typeof obj.stats === "object") provided = obj.stats;
    }
  }

  const derived = computeStats(rows);

  if (provided) {
    return {
      rows,
      stats: {
        ...derived,
        ...provided,
        counts: { ...derived.counts, ...(provided.counts ?? {}) },
        events: { ...derived.events, ...(provided.events ?? {}) },
        qa_by_stage: provided.qa_by_stage ?? derived.qa_by_stage,
      },
    };
  }

  return { rows, stats: derived };
}
