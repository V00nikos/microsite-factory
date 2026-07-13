import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import css from "./FleetBoard.module.css";
import { useFleet } from "../hooks/FleetProvider";
import { StatusPill } from "../components/StatusPill";
import { ActivityPanel } from "../components/ActivityPanel";
import { usd, compact, hostLabel } from "../lib/format";
import type { FleetRow, FleetStatus, Stage, StageRate } from "../lib/types";

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */
const STAGES: Stage[] = ["research", "build", "deploy"];
const STAGE_LABEL: Record<Stage, string> = {
  research: "Research",
  build: "Build",
  deploy: "Deploy",
};

const STATUS_PRIORITY: Record<FleetStatus, number> = {
  blocked: 0,
  in_progress: 1,
  queued: 2,
  shipped: 3,
};

type Filter = "all" | "in_progress" | "shipped" | "blocked" | "queued";

const COMP_ORDER: { key: FleetStatus; label: string; color: string }[] = [
  { key: "shipped", label: "Shipped", color: "var(--good)" },
  { key: "in_progress", label: "In flight", color: "var(--accent)" },
  { key: "queued", label: "Queued", color: "var(--muted)" },
  { key: "blocked", label: "Blocked", color: "var(--critical)" },
];

function pctOrDash(rate: number | null | undefined): string {
  if (rate == null) return "—";
  return Math.round(rate * 100) + "%";
}
function accountRate(row: FleetRow): number | null {
  if (!row.qa || row.qa.total <= 0) return null;
  return row.qa.first_pass / row.qa.total;
}

/** Arm entrance/fill animations one frame after mount (reference does the same). */
function useArmed(): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setArmed(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);
  return armed;
}

/* ------------------------------------------------------------------ */
/*  Sparkline — honest series: cumulative first-pass QA rate as the     */
/*  fleet was built (accounts with QA data, oldest -> newest).          */
/* ------------------------------------------------------------------ */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 78;
  const h = 26;
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const r = mx - mn || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * w,
    h - 2 - ((v - mn) / r) * (h - 6),
  ]);
  const d = pts
    .map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1))
    .join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg className={css.spark} width={w} height={h} aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r={2.6} fill="var(--accent)" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Stage stepper (reference "node · link" track with a text label)     */
/* ------------------------------------------------------------------ */
function Stepper({ row }: { row: FleetRow }) {
  const cur = Math.max(0, STAGES.indexOf(row.stage as Stage));
  const nodeCls = (i: number): string => {
    if (row.status === "shipped") return css.done;
    if (row.status === "blocked") {
      if (i < cur) return css.done;
      if (i === cur) return css.fail;
      return "";
    }
    if (i < cur) return css.done;
    if (i === cur) return css.cur;
    return "";
  };
  const linkDone = (i: number) => row.status === "shipped" || i < cur;
  const label =
    row.status === "shipped"
      ? "deployed"
      : row.status === "blocked"
        ? `blocked · ${row.stage}`
        : row.status === "queued"
          ? "queued"
          : row.stage;
  return (
    <div className={css.stepperWrap}>
      <span className={css.stepper} aria-hidden="true">
        {STAGES.map((s, i) => (
          <span className={css.step} key={s}>
            <span className={`${css.node} ${nodeCls(i)}`} />
            {i < STAGES.length - 1 && (
              <span className={`${css.link} ${linkDone(i) ? css.linkDone : ""}`} />
            )}
          </span>
        ))}
      </span>
      <span className={css.stageLbl}>{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Charts                                                             */
/* ------------------------------------------------------------------ */
function QaByStage({ byStage, armed }: { byStage: Record<Stage, StageRate>; armed: boolean }) {
  return (
    <div className={css.qabars}>
      {STAGES.map((s) => {
        const rate = byStage[s]?.rate ?? null;
        const w = armed && rate != null ? rate * 100 : 0;
        return (
          <div className={css.qarow} key={s}>
            <div className={css.qaName}>{STAGE_LABEL[s]}</div>
            <div className={css.qatrack}>
              <div className={css.qafill} style={{ width: `${w}%` }} />
            </div>
            <div className={`${css.qapct} tnum`}>{pctOrDash(rate)}</div>
          </div>
        );
      })}
    </div>
  );
}

function Composition({
  counts,
  total,
  armed,
}: {
  counts: Record<FleetStatus, number>;
  total: number;
  armed: boolean;
}) {
  const present = COMP_ORDER.filter((c) => counts[c.key] > 0);
  return (
    <>
      <div className={css.compbar}>
        {present.map((c) => (
          <div
            key={c.key}
            className={css.seg}
            style={{
              flexGrow: armed ? counts[c.key] : 0,
              background: c.color,
            }}
            title={`${c.label}: ${counts[c.key]} of ${total}`}
          />
        ))}
        {total === 0 && <div className={css.segEmpty} />}
      </div>
      <div className={css.legend}>
        {COMP_ORDER.map((c) => (
          <div className={css.lg} key={c.key}>
            <span className={css.chip} style={{ background: c.color }} />
            {c.label}
            <span className={`${css.lgN} tnum`}>{counts[c.key]}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function Funnel({
  events,
  armed,
}: {
  events: { view: number; scroll50: number; cta: number };
  armed: boolean;
}) {
  const steps = [
    { label: "Views", n: events.view, color: "var(--fun-1)" },
    { label: "Scroll 50%", n: events.scroll50, color: "var(--fun-2)" },
    { label: "CTA click", n: events.cta, color: "var(--fun-3)" },
  ];
  const mx = steps[0].n || 1;
  return (
    <div className={css.funnel}>
      {steps.map((s, i) => (
        <div key={s.label}>
          <div className={css.frow}>
            <div className={css.fl}>{s.label}</div>
            <div className={css.fbarWrap}>
              <div
                className={`${css.fbar} tnum`}
                style={{
                  width: armed ? `${Math.max((s.n / mx) * 100, s.n > 0 ? 14 : 4)}%` : "0%",
                  background: s.color,
                }}
              >
                {compact(s.n)}
              </div>
            </div>
          </div>
          {i > 0 && (
            <div className={`${css.fconv} tnum`}>
              {steps[i - 1].n > 0 ? Math.round((s.n / steps[i - 1].n) * 100) : 0}% of{" "}
              {steps[i - 1].label.toLowerCase()}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Table row                                                          */
/* ------------------------------------------------------------------ */
function AccountRow({ row }: { row: FleetRow }) {
  const navigate = useNavigate();
  const [flash, setFlash] = useState(false);
  const prev = useRef(row.updated_at);
  useEffect(() => {
    if (row.updated_at !== prev.current) {
      prev.current = row.updated_at;
      setFlash(true);
      const id = setTimeout(() => setFlash(false), 1300);
      return () => clearTimeout(id);
    }
  }, [row.updated_at]);

  const blocked = row.status === "blocked";
  const rate = accountRate(row);
  const go = () => navigate(`/preview/${encodeURIComponent(row.account_id)}`);
  const rowCls = `${css.trow} ${blocked ? css.blockedRow : ""} ${flash ? css.flash : ""}`;

  return (
    <>
      <tr
        className={rowCls}
        onClick={go}
        tabIndex={0}
        role="button"
        aria-label={`${row.company} — ${row.status}. Open preview.`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            go();
          }
        }}
      >
        <td>
          <div className={css.acct}>
            <span className={css.stripe} />
            <div className={css.acctText}>
              <div className={css.co}>{row.company}</div>
              <div className={`${css.acctId} mono`}>
                {row.account_id}
                {row.contact_title ? ` · ${row.contact_title}` : ""}
              </div>
            </div>
          </div>
        </td>
        <td>
          <Stepper row={row} />
        </td>
        <td>
          <StatusPill status={row.status} />
        </td>
        <td className={css.num}>
          {row.cost_usd > 0 ? (
            <span className={`${css.cost} tnum`}>{usd(row.cost_usd)}</span>
          ) : (
            <span className={css.dash}>—</span>
          )}
        </td>
        <td>
          {rate == null ? (
            <span className={css.dash}>—</span>
          ) : (
            <div className={css.miniqa}>
              <div className={css.miniBar}>
                <span
                  style={{
                    width: `${rate * 100}%`,
                    background: rate < 0.6 ? "var(--critical)" : "var(--accent)",
                  }}
                />
              </div>
              <span className={`${css.miniT} tnum`}>{pctOrDash(rate)}</span>
            </div>
          )}
        </td>
        <td>
          {row.status === "shipped" && row.events ? (
            <div className={css.events}>
              <span className={css.ev}>
                <span className={`${css.evN} tnum`}>{compact(row.events.view)}</span>
                <span className={css.evL}>view</span>
              </span>
              <span className={css.ev}>
                <span className={`${css.evN} tnum`}>{compact(row.events.scroll50)}</span>
                <span className={css.evL}>50%</span>
              </span>
              <span className={`${css.ev} ${row.events.cta > 0 ? css.evHot : ""}`}>
                <span className={`${css.evN} tnum`}>{compact(row.events.cta)}</span>
                <span className={css.evL}>cta</span>
              </span>
            </div>
          ) : (
            <span className={css.dash}>—</span>
          )}
        </td>
        <td className={css.urlcell}>
          {row.url ? (
            <a
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={row.url}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }} aria-hidden="true">
                <path d="M7 17 17 7M8 7h9v9" />
              </svg>
              {hostLabel(row.url).replace(".pages.dev", "")}
            </a>
          ) : (
            <span className={css.dash}>—</span>
          )}
        </td>
      </tr>
      {blocked && row.blocked_reason && (
        <tr className={`${css.blockedRow} ${css.reasonTr}`}>
          <td colSpan={7}>
            <div className={css.reason}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
              </svg>
              <span>{row.blocked_reason}</span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  KPI hero + strip                                                   */
/* ------------------------------------------------------------------ */
function KpiRow({
  rate,
  spark,
  gatesRun,
  shipped,
  total,
  inFlight,
  blocked,
  costPerSite,
  totalCost,
}: {
  rate: number;
  spark: number[];
  gatesRun: number;
  shipped: number;
  total: number;
  inFlight: number;
  blocked: number;
  costPerSite: number | null;
  totalCost: number;
}) {
  return (
    <div className={css.kpis}>
      <div className={`${css.card} ${css.kpi} ${css.hero} ${css.rise}`}>
        <div className={css.kpiLabel}>Overall first-pass QA</div>
        <div className={`${css.kpiVal} tnum`}>{Math.round(rate * 100)}%</div>
        <div className={css.kpiFoot}>
          {gatesRun > 0 ? `${gatesRun} first-pass gate${gatesRun === 1 ? "" : "s"} run` : "awaiting first gate"}
        </div>
        <Sparkline values={spark} />
      </div>

      <div className={`${css.card} ${css.kpi} ${css.rise}`}>
        <div className={css.kpiLabel}>Shipped</div>
        <div className={`${css.kpiVal} tnum`}>
          {shipped}
          <small> / {total}</small>
        </div>
        <div className={css.kpiFoot}>live URLs on Cloudflare Pages</div>
      </div>

      <div className={`${css.card} ${css.kpi} ${css.rise}`}>
        <div className={css.kpiLabel}>In flight</div>
        <div className={`${css.kpiVal} tnum`}>{inFlight}</div>
        <div className={css.kpiFoot}>max 5 concurrent · rest queued</div>
      </div>

      <div className={`${css.card} ${css.kpi} ${css.rise}`}>
        <div className={css.kpiLabel}>Blocked</div>
        <div className={`${css.kpiVal} tnum`} style={blocked ? { color: "var(--critical)" } : undefined}>
          {blocked}
        </div>
        <div className={css.kpiFoot}>held at a QA gate — see reasons</div>
      </div>

      <div className={`${css.card} ${css.kpi} ${css.rise}`}>
        <div className={css.kpiLabel}>Cost / site</div>
        <div className={`${css.kpiVal} tnum`}>{costPerSite != null ? usd(costPerSite) : "—"}</div>
        <div className={css.kpiFoot}>{usd(totalCost)} total · $2.00 ceiling</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Screen                                                             */
/* ------------------------------------------------------------------ */
export function FleetBoard() {
  const { board, loading, source, notice } = useFleet();
  const [filter, setFilter] = useState<Filter>("all");
  const armed = useArmed();

  const { stats } = board;
  const total = board.rows.length;

  const sorted = useMemo(
    () =>
      [...board.rows].sort((a, b) => {
        const p = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
        if (p !== 0) return p;
        return (b.updated_at || 0) - (a.updated_at || 0);
      }),
    [board.rows]
  );
  const visible = useMemo(
    () => (filter === "all" ? sorted : sorted.filter((r) => r.status === filter)),
    [sorted, filter]
  );

  // Honest sparkline: cumulative first-pass rate over accounts, oldest -> newest.
  const spark = useMemo(() => {
    const withQa = board.rows
      .filter((r) => r.qa && r.qa.total > 0)
      .sort((a, b) => (a.updated_at || 0) - (b.updated_at || 0));
    const out: number[] = [];
    let passed = 0;
    let totalG = 0;
    for (const r of withQa) {
      passed += r.qa!.first_pass;
      totalG += r.qa!.total;
      if (totalG > 0) out.push(passed / totalG);
    }
    return out;
  }, [board.rows]);

  const costPerSite = stats.counts.shipped > 0 ? stats.total_cost_usd / stats.counts.shipped : null;

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: total },
    { key: "in_progress", label: "In flight", count: stats.counts.in_progress },
    { key: "shipped", label: "Shipped", count: stats.counts.shipped },
    { key: "blocked", label: "Blocked", count: stats.counts.blocked },
    { key: "queued", label: "Queued", count: stats.counts.queued },
  ];

  return (
    <div className={css.layout}>
      <div className={css.main}>
        {notice && (
          <div className={`${css.notice} ${source === "unconfigured" ? css.noticeOff : ""}`}>
            {notice}
          </div>
        )}

        <div className={css.head}>
          <div className={css.title}>
            <h1>Fleet Board</h1>
            <p>Autonomous research-grade microsites — one per account, QA-gated at every stage.</p>
          </div>
          <span className={css.liveTag}>
            <i />
            {source === "convex" ? "Streaming" : source === "demo" ? "Simulated" : "Idle"}
          </span>
        </div>

        <KpiRow
          rate={stats.first_pass_qa_rate}
          spark={spark}
          gatesRun={stats.qa_total}
          shipped={stats.counts.shipped}
          total={total}
          inFlight={stats.counts.in_progress}
          blocked={stats.counts.blocked}
          costPerSite={costPerSite}
          totalCost={stats.total_cost_usd}
        />

        <div className={css.charts}>
          <div className={`${css.card} ${css.panel} ${css.rise}`}>
            <div className={css.panelHead}>
              <div>
                <h3>First-pass QA rate</h3>
                <div className={css.hint}>Passed on the first try — no retry. The factory's health metric.</div>
              </div>
              <span className={css.tag}>by stage</span>
            </div>
            <QaByStage byStage={stats.qa_by_stage} armed={armed} />
          </div>

          <div className={`${css.card} ${css.panel} ${css.rise}`}>
            <div className={css.panelHead}>
              <div>
                <h3>Fleet composition</h3>
                <div className={css.hint}>Where every account stands right now.</div>
              </div>
              <span className={css.tag}>{total} account{total === 1 ? "" : "s"}</span>
            </div>
            <Composition counts={stats.counts} total={total} armed={armed} />
          </div>

          <div className={`${css.card} ${css.panel} ${css.rise}`}>
            <div className={css.panelHead}>
              <div>
                <h3>Visitor engagement</h3>
                <div className={css.hint}>Beacon events across shipped sites.</div>
              </div>
              <span className={css.tag}>funnel</span>
            </div>
            <Funnel events={stats.events} armed={armed} />
          </div>
        </div>

        <div className={css.tablewrap}>
          <div className={css.tableHead}>
            <h2>Accounts</h2>
            <div className={css.filters} role="group" aria-label="Filter by status">
              {filters.map((f) => (
                <button
                  key={f.key}
                  className={css.fbtn}
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <span className={css.fcount}>{f.count}</span>
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className={css.scroller}>
              <div className={css.skelWrap}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className={css.skel} />
                ))}
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className={css.empty}>
              <h3>{total === 0 ? "No accounts in the fleet yet" : "Nothing matches this filter"}</h3>
              <p>
                {total === 0 ? (
                  <>
                    Head to <Link to="/intake">Intake</Link> to paste your ICP list and run the factory.
                  </>
                ) : (
                  "Try a different status filter."
                )}
              </p>
            </div>
          ) : (
            <div className={css.scroller}>
              <table className={css.table}>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Stage</th>
                    <th>Status</th>
                    <th className={css.num}>Cost</th>
                    <th>First-pass QA</th>
                    <th>Engagement</th>
                    <th>Live URL</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <AccountRow key={row.account_id} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className={css.footNote}>
            Blocked accounts show the QA gate's verdict <b>verbatim</b> — restraint is a feature.
            Reads come straight from Convex live queries; commands reach Hermes only through
            HMAC-signed webhooks.
          </div>
        </div>
      </div>

      <ActivityPanel />
    </div>
  );
}
