// Shared domain types for the operator console.
// These mirror the frozen Convex schema (see CLAUDE.md "Convex schema") plus the
// aggregated shape the frontend expects from the `fleetBoard` live query.

export type FleetStatus = "queued" | "in_progress" | "blocked" | "shipped";
export type Angle = "cost" | "speed" | "risk" | "talent" | "competition";
export type ProofTag = "technical" | "roi" | "gtm";
export type BeaconType = "view" | "scroll50" | "cta";
export type Stage = "research" | "build" | "deploy";

/** First-pass QA tally for a stage (or overall). rate is null when no first-pass
 *  traces exist yet — distinguishes "no data" from a genuine 0%. */
export interface StageRate {
  first_pass: number;
  passed: number;
  rate: number | null;
}

/** Backend per-account / fleet-wide first-pass QA breakdown (queries.ts). */
export interface FirstPassQa {
  by_stage: Record<Stage, StageRate>;
  overall: StageRate;
}

export interface EventCounts {
  view: number;
  scroll50: number;
  cta: number;
}

/** The editable strategy surface produced by the microsite-builder (angle_log). */
export interface AngleLog {
  angle: Angle | string;
  /** Indices into the researcher `findings[]` that justify the angle. */
  because_findings: number[];
  objection_addressed: string;
}

/**
 * One account row on the fleet board. Fields marked optional are enrichments the
 * backend MAY include (design_system, angle_log, findings, events, qa). The board
 * degrades gracefully when they are absent.
 */
export interface FleetRow {
  account_id: string;
  company: string;
  stage: string; // "research" | "build" | "deploy" | "shipped" | ...
  status: FleetStatus;
  blocked_reason?: string | null;
  cost_usd: number;
  url?: string | null;
  updated_at: number; // epoch ms

  // enrichments (optional)
  contact_title?: string;
  vertical?: string;
  design_system?: string; // ledger | terminal | clinic | signal
  signature_element?: string;
  angle_log?: AngleLog | null;
  findings?: Array<{ claim: string; source_url: string; recency?: string }>;
  events?: EventCounts;
  /** Per-account QA tally, first-pass = passed on first attempt (retry_of == null). */
  qa?: { first_pass: number; total: number };
  /** Full per-account first-pass breakdown (by stage + overall) from the backend. */
  first_pass_qa?: FirstPassQa | null;
}

export interface FleetStats {
  first_pass_qa_rate: number; // 0..1, fleet-wide, the factory's single health metric
  qa_first_pass: number;
  qa_total: number;
  /** Fleet-wide first-pass QA rate per pipeline stage — powers the by-stage chart. */
  qa_by_stage: Record<Stage, StageRate>;
  total_cost_usd: number;
  counts: Record<FleetStatus, number>;
  events: EventCounts;
}

export interface FleetBoard {
  rows: FleetRow[];
  stats: FleetStats;
}

export interface Positioning {
  one_liner: string;
  proof_points: Array<{ tag: ProofTag; text: string }>;
  tone_rules: string[];
  forbidden_claims: string[];
  verticals: string[];
}
