import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import css from "./Preview.module.css";
import { useFleet } from "../hooks/FleetProvider";
import { StatusPill } from "../components/StatusPill";
import { StageTrack } from "../components/StageTrack";
import { useToast } from "../components/Toast";
import { regenerate } from "../lib/factoryApi";
import { hostLabel } from "../lib/format";
import type { Angle, FleetRow } from "../lib/types";

const ARCHETYPES: { key: Angle; blurb: string }[] = [
  { key: "cost", blurb: "Cheaper than the status quo" },
  { key: "speed", blurb: "Ship / move faster" },
  { key: "risk", blurb: "De-risk the decision" },
  { key: "talent", blurb: "Augment their team" },
  { key: "competition", blurb: "Edge over rivals" },
];

/* ---------------------------------- picker ---------------------------------- */
export function PreviewIndex() {
  const { board } = useFleet();
  const navigate = useNavigate();
  const rows = useMemo(
    () =>
      [...board.rows].sort((a, b) => {
        const rank = (r: FleetRow) => (r.status === "shipped" ? 0 : r.status === "blocked" ? 1 : 2);
        return rank(a) - rank(b) || (b.updated_at || 0) - (a.updated_at || 0);
      }),
    [board.rows]
  );

  return (
    <div className={css.picker}>
      <h1>Preview & edit</h1>
      <p>Pick an account to inspect its site, review the angle it chose, and steer a regeneration.</p>
      {rows.length === 0 ? (
        <div style={{ color: "var(--fg-faint)", fontSize: 14 }}>
          No accounts yet. Run the factory from <Link to="/intake">Intake</Link>.
        </div>
      ) : (
        <div className={css.pickList}>
          {rows.map((r) => (
            <button
              key={r.account_id}
              className={css.pickRow}
              onClick={() => navigate(`/preview/${encodeURIComponent(r.account_id)}`)}
            >
              <div>
                <b>{r.company}</b>
                <div className={css.pid}>{r.account_id}</div>
              </div>
              <div className={css.pickSpacer} />
              {r.angle_log?.angle && <span className="mono" style={{ fontSize: 12, color: "var(--fg-faint)" }}>angle: {r.angle_log.angle}</span>}
              <StatusPill status={r.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- detail ---------------------------------- */
function PipeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Preview() {
  const { accountId } = useParams();
  const { board, source } = useFleet();
  const toast = useToast();
  const navigate = useNavigate();

  const row = useMemo(
    () => board.rows.find((r) => r.account_id === accountId),
    [board.rows, accountId]
  );

  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [angle, setAngle] = useState<Angle>(
    (ARCHETYPES.find((a) => a.key === (row?.angle_log?.angle as Angle))?.key) ?? "cost"
  );
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<null | "angle" | "instruction">(null);

  if (!row) {
    return (
      <div className={css.picker}>
        <Link to="/preview" className={css.backLink}>
          ← all accounts
        </Link>
        <h1>Account not found</h1>
        <p>
          <span className="mono">{accountId}</span> isn't in the current fleet snapshot
          {source !== "convex" ? " (no live source connected)" : " — it may still be queued or not yet written to Convex"}.
        </p>
      </div>
    );
  }

  async function sendAngle() {
    setBusy("angle");
    const res = await regenerate({ account_id: row!.account_id, mode: "angle", angle });
    setBusy(null);
    if (res.ok) {
      toast("info", <><strong>Regeneration queued.</strong> New angle <em>{angle}</em> re-enters build → QA → deploy. Watch the fleet board.</>);
    } else {
      toast("err", <><strong>Regenerate failed.</strong> {res.error}{res.detail ? ` — ${res.detail}` : ""}</>);
    }
  }

  async function sendInstruction() {
    if (!instruction.trim()) return;
    setBusy("instruction");
    const res = await regenerate({ account_id: row!.account_id, mode: "instruction", instruction: instruction.trim() });
    setBusy(null);
    if (res.ok) {
      setInstruction("");
      toast("info", <><strong>Instruction sent.</strong> The builder re-runs with your note, then passes QA before redeploy.</>);
    } else {
      toast("err", <><strong>Regenerate failed.</strong> {res.error}{res.detail ? ` — ${res.detail}` : ""}</>);
    }
  }

  function approve() {
    toast("ok", <><strong>Approved.</strong> {row!.company}'s site stays live as-is — no regeneration.</>);
  }

  const angleLog = row.angle_log;

  return (
    <>
      <div style={{ padding: "var(--sp-3) var(--sp-5) 0", maxWidth: 1700, margin: "0 auto" }}>
        <button className={css.backLink} onClick={() => navigate("/")}>
          ← fleet board
        </button>
      </div>
      <div className={css.wrap}>
        {/* viewport */}
        <section className={css.viewport}>
          <div className={css.browserChrome}>
            <div className={css.dots}>
              <i />
              <i />
              <i />
            </div>
            <div className={css.addr}>
              {row.url ? (
                <>
                  <span className={css.lock}>●</span>
                  {hostLabel(row.url)}
                </>
              ) : (
                <span style={{ color: "var(--fg-ghost)" }}>awaiting deploy…</span>
              )}
            </div>
            <div className={css.chromeBtns}>
              <button
                className={`${css.iconBtn} ${device === "desktop" ? css.on : ""}`}
                onClick={() => setDevice("desktop")}
                aria-pressed={device === "desktop"}
              >
                Desktop
              </button>
              <button
                className={`${css.iconBtn} ${device === "mobile" ? css.on : ""}`}
                onClick={() => setDevice("mobile")}
                aria-pressed={device === "mobile"}
              >
                Mobile
              </button>
              {row.url && (
                <a className={css.iconBtn} href={row.url} target="_blank" rel="noreferrer">
                  Open ↗
                </a>
              )}
            </div>
          </div>
          <div className={`${css.frameHost} ${device === "mobile" ? css.mobile : ""}`}>
            {row.url ? (
              <iframe
                key={row.url + device}
                className={css.frame}
                src={row.url}
                title={`${row.company} microsite`}
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className={css.noFrame}>
                <div>
                  <div className={css.big}>No live URL yet</div>
                  This account is {row.status.replace("_", " ")} at the{" "}
                  <span className="mono">{row.stage}</span> stage. The preview appears once it deploys.
                </div>
              </div>
            )}
          </div>
        </section>

        {/* side */}
        <aside className={css.side}>
          {/* account */}
          <div className={`panel ${css.card} ${css.acctHead}`}>
            <h2>{row.company}</h2>
            <div className={css.acctId}>{row.account_id}</div>
            <div className={css.headMeta}>
              <StatusPill status={row.status} />
              {row.contact_title && <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>{row.contact_title}</span>}
            </div>
            <div className={css.trackHost}>
              <StageTrack stage={row.stage} status={row.status} />
            </div>
          </div>

          {/* angle log */}
          <div className={`panel ${css.card}`}>
            <div className={css.cardLabel}>Angle log · the editable surface</div>
            {angleLog ? (
              <>
                <div className={css.angleName}>
                  <b>{angleLog.angle}</b>
                  <span>{ARCHETYPES.find((a) => a.key === angleLog.angle)?.blurb}</span>
                </div>
                {angleLog.objection_addressed && (
                  <div className={css.objection}>
                    Addresses objection: <em>{angleLog.objection_addressed}</em>
                  </div>
                )}
                <div className={css.cardLabel}>Because — findings</div>
                <div className={css.evList}>
                  {angleLog.because_findings?.length ? (
                    angleLog.because_findings.map((idx) => {
                      const f = row.findings?.[idx];
                      return (
                        <div className={css.evItem} key={idx}>
                          <span className={css.evIdx}>#{idx}</span>
                          <span>
                            {f ? (
                              <>
                                {f.claim}{" "}
                                {f.source_url && (
                                  <a href={f.source_url} target="_blank" rel="noreferrer">
                                    [source]
                                  </a>
                                )}
                              </>
                            ) : (
                              <span style={{ color: "var(--fg-faint)" }}>finding index {idx}</span>
                            )}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <span className={css.noAngle}>No findings linked.</span>
                  )}
                </div>
              </>
            ) : (
              <p className={css.noAngle}>
                No angle log yet — this account hasn't reached the build stage. Once the builder runs,
                the chosen archetype, the findings that justify it, and the objection it answers appear here.
              </p>
            )}
          </div>

          {/* controls */}
          <div className={`panel ${css.card}`}>
            <div className={css.cardLabel}>Steer · strategy, not pixels</div>
            <div className={css.controls}>
              {/* regenerate angle */}
              <div>
                <label className="eyebrow" style={{ display: "block", marginBottom: 8 }}>
                  Regenerate with a different angle
                </label>
                <div className={css.angleGrid}>
                  {ARCHETYPES.map((a) => (
                    <button
                      key={a.key}
                      className={`${css.angleOpt} ${angle === a.key ? css.sel : ""}`}
                      onClick={() => setAngle(a.key)}
                      aria-pressed={angle === a.key}
                    >
                      <b>{a.key}</b>
                      <span>{a.blurb}</span>
                    </button>
                  ))}
                </div>
                <button
                  className="btn"
                  style={{ width: "100%", marginTop: 10 }}
                  onClick={sendAngle}
                  disabled={busy !== null}
                >
                  {busy === "angle" ? "Queuing…" : `Regenerate as “${angle}”`}
                </button>
              </div>

              {/* regenerate with instruction */}
              <div>
                <label htmlFor="instr" className="eyebrow" style={{ display: "block", marginBottom: 8 }}>
                  Regenerate with an instruction
                </label>
                <textarea
                  id="instr"
                  className={css.instr}
                  placeholder="e.g. make the hero punchier and lead with their ROS 2 migration"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                />
                <button
                  className="btn"
                  style={{ width: "100%", marginTop: 10 }}
                  onClick={sendInstruction}
                  disabled={busy !== null || !instruction.trim()}
                >
                  {busy === "instruction" ? "Sending…" : "Regenerate with instruction"}
                </button>
              </div>

              <div className={css.pipeNote}>
                <PipeIcon />
                <span>
                  Every edit re-enters builder → QA → deploy and leaves a trace. No path bypasses the
                  gate — you'll see this account flip to <b style={{ color: "var(--amber-bright)" }}>in&nbsp;progress</b> on
                  the board.
                </span>
              </div>

              {/* approve */}
              <div className={css.approveRow}>
                <button className="btn btn-primary" onClick={approve}>
                  ✓ Approve current site
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
