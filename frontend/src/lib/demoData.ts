// Demo-only simulated fleet, gated behind VITE_DEMO_MODE=true.
//
// This exists so the control-room board can be seen and demoed WITHOUT a running
// Convex backend (useful for design QA and offline rehearsal). It is never used
// when VITE_DEMO_MODE is unset/false — in that (default) mode the board reads
// exclusively from the live Convex query. No fake data ever reaches production.

import type { FirstPassQa, FleetRow, Stage } from "./types";

export const DEMO_ENABLED = import.meta.env.VITE_DEMO_MODE === "true";

const now = () => Date.now();

const STAGES: Stage[] = ["research", "build", "deploy"];

/** Build a first_pass_qa block from [first_pass, passed] pairs per stage. */
function fpq(
  research: [number, number],
  build: [number, number],
  deploy: [number, number]
): FirstPassQa {
  const pairs: Record<Stage, [number, number]> = { research, build, deploy };
  const by_stage = {} as FirstPassQa["by_stage"];
  let fp = 0;
  let pa = 0;
  for (const s of STAGES) {
    const [first_pass, passed] = pairs[s];
    fp += first_pass;
    pa += passed;
    by_stage[s] = { first_pass, passed, rate: first_pass > 0 ? passed / first_pass : null };
  }
  return { by_stage, overall: { first_pass: fp, passed: pa, rate: fp > 0 ? pa / fp : null } };
}

function overallQa(f: FirstPassQa): { first_pass: number; total: number } {
  return { first_pass: f.overall.passed, total: f.overall.first_pass };
}

function seed(): FleetRow[] {
  const t = now();
  const northwind = fpq([1, 1], [1, 1], [1, 1]);
  const ledgerly = fpq([1, 1], [0, 0], [0, 0]);
  const cadence = fpq([0, 0], [0, 0], [0, 0]);
  const volt = fpq([1, 0], [0, 0], [0, 0]);
  const parsec = fpq([1, 1], [1, 0], [0, 0]);
  const atlas = fpq([1, 1], [1, 0], [1, 1]);

  return [
    {
      account_id: "northwind-robotics-vp-eng",
      company: "Northwind Robotics",
      contact_title: "VP Engineering",
      vertical: "Industrial Automation",
      stage: "deploy",
      status: "shipped",
      cost_usd: 1.42,
      url: "https://northwind-robotics-vp-eng.pages.dev",
      updated_at: t - 42_000,
      design_system: "terminal",
      signature_element: "Live fleet-throughput diagram from their ROS stack",
      angle_log: {
        angle: "speed",
        because_findings: [0, 2, 4],
        objection_addressed: "“We already have an internal tools team.”",
      },
      findings: [
        {
          claim: "Hiring 4 robotics platform engineers in Q3",
          source_url: "https://northwind.io/careers",
          recency: "2026-06",
        },
        {
          claim: "Migrated fleet orchestration to ROS 2 Humble",
          source_url: "https://northwind.io/blog/ros2-migration",
          recency: "2026-05",
        },
      ],
      events: { view: 38, scroll50: 21, cta: 5 },
      qa: overallQa(northwind),
      first_pass_qa: northwind,
    },
    {
      account_id: "ledgerly-cfo",
      company: "Ledgerly",
      contact_title: "CFO",
      vertical: "Fintech",
      stage: "build",
      status: "in_progress",
      cost_usd: 0.71,
      url: null,
      updated_at: t - 3_000,
      design_system: "ledger",
      angle_log: {
        angle: "risk",
        because_findings: [1],
        objection_addressed: "“Compliance review will take months.”",
      },
      events: { view: 0, scroll50: 0, cta: 0 },
      qa: overallQa(ledgerly),
      first_pass_qa: ledgerly,
    },
    {
      account_id: "cadence-health-head-data",
      company: "Cadence Health",
      contact_title: "Head of Data",
      vertical: "Digital Health",
      stage: "research",
      status: "in_progress",
      cost_usd: 0.28,
      url: null,
      updated_at: t - 1_500,
      events: { view: 0, scroll50: 0, cta: 0 },
      qa: overallQa(cadence),
      first_pass_qa: cadence,
    },
    {
      account_id: "volt-mobility-cto",
      company: "Volt Mobility",
      contact_title: "CTO",
      vertical: "Mobility",
      stage: "research",
      status: "blocked",
      blocked_reason:
        "RESEARCH GATE — confidence 0.41 < 0.50 floor. Only 2 findings carried a real source_url (need ≥5); 'fleet electrification roadmap' claim could not be corroborated from a second source. No build attempted.",
      cost_usd: 0.33,
      url: null,
      updated_at: t - 88_000,
      qa: overallQa(volt),
      first_pass_qa: volt,
    },
    {
      account_id: "parsec-analytics-vp-data",
      company: "Parsec Analytics",
      contact_title: "VP Data",
      vertical: "Data Infrastructure",
      stage: "build",
      status: "blocked",
      blocked_reason:
        "BUILD GATE — product claim 'SOC 2 Type II certified' is absent from positioning memory. Builder cannot assert capabilities the operator has not briefed. Retry with claim removed or add it to the GTM planner.",
      cost_usd: 0.94,
      url: null,
      updated_at: t - 120_000,
      design_system: "signal",
      qa: overallQa(parsec),
      first_pass_qa: parsec,
    },
    {
      account_id: "meridian-labs-head-eng",
      company: "Meridian Labs",
      contact_title: "Head of Engineering",
      vertical: "Dev Tools",
      stage: "queued",
      status: "queued",
      cost_usd: 0,
      url: null,
      updated_at: t - 6_000,
    },
    {
      account_id: "atlas-freight-coo",
      company: "Atlas Freight",
      contact_title: "COO",
      vertical: "Logistics",
      stage: "deploy",
      status: "shipped",
      cost_usd: 1.61,
      url: "https://atlas-freight-coo.pages.dev",
      updated_at: t - 240_000,
      design_system: "clinic",
      signature_element: "Before/after lane-utilization ledger",
      angle_log: {
        angle: "cost",
        because_findings: [0, 3],
        objection_addressed: "“We just signed with a competitor.”",
      },
      events: { view: 64, scroll50: 40, cta: 11 },
      qa: overallQa(atlas),
      first_pass_qa: atlas,
    },
    {
      account_id: "brightloop-edu-cpo",
      company: "Brightloop",
      contact_title: "CPO",
      vertical: "EdTech",
      stage: "queued",
      status: "queued",
      cost_usd: 0,
      url: null,
      updated_at: t - 9_000,
    },
  ];
}

/** Record a first-pass gate result onto a row's first_pass_qa (mutating a copy). */
function recordGate(row: FleetRow, stage: Stage, pass: boolean): FirstPassQa {
  const base: FirstPassQa =
    row.first_pass_qa ?? {
      by_stage: {
        research: { first_pass: 0, passed: 0, rate: null },
        build: { first_pass: 0, passed: 0, rate: null },
        deploy: { first_pass: 0, passed: 0, rate: null },
      },
      overall: { first_pass: 0, passed: 0, rate: null },
    };
  const by_stage = {
    research: { ...base.by_stage.research },
    build: { ...base.by_stage.build },
    deploy: { ...base.by_stage.deploy },
  };
  const b = by_stage[stage];
  b.first_pass += 1;
  if (pass) b.passed += 1;
  b.rate = b.first_pass > 0 ? b.passed / b.first_pass : null;
  const fp = base.overall.first_pass + 1;
  const pa = base.overall.passed + (pass ? 1 : 0);
  return { by_stage, overall: { first_pass: fp, passed: pa, rate: fp > 0 ? pa / fp : null } };
}

/**
 * Returns a mutable dataset and a `tick()` that nudges it forward to simulate the
 * live pipeline (cost accrues, stages advance, beacon events arrive). Used only by
 * the demo hook.
 */
export function createDemoFleet() {
  let rows = seed();

  function tick(): FleetRow[] {
    const t = now();
    rows = rows.map((r) => {
      const next = { ...r };
      // In-progress accounts accrue cost and occasionally advance a stage.
      if (next.status === "in_progress") {
        next.cost_usd = Math.min(2, +(next.cost_usd + 0.01 + Math.random() * 0.03).toFixed(2));
        if (Math.random() < 0.06) {
          next.updated_at = t;
          if (next.stage === "research") {
            next.stage = "build";
            next.first_pass_qa = recordGate(next, "research", true);
            next.qa = overallQa(next.first_pass_qa);
          } else if (next.stage === "build") {
            next.stage = "deploy";
            next.status = "shipped";
            next.url = `https://${next.account_id}.pages.dev`;
            next.first_pass_qa = recordGate(next, "build", true);
            next.first_pass_qa = recordGate(next, "deploy", true);
            next.qa = overallQa(next.first_pass_qa);
          }
        }
      }
      // Queued accounts eventually start.
      if (next.status === "queued" && Math.random() < 0.03) {
        next.status = "in_progress";
        next.stage = "research";
        next.updated_at = t;
      }
      // Shipped accounts collect beacon events.
      if (next.status === "shipped" && next.events && Math.random() < 0.25) {
        next.events = { ...next.events };
        next.events.view += Math.random() < 0.7 ? 1 : 0;
        if (Math.random() < 0.4) next.events.scroll50 += 1;
        if (Math.random() < 0.12) next.events.cta += 1;
        next.updated_at = t;
      }
      return next;
    });
    return rows;
  }

  return { get: () => rows, tick };
}
