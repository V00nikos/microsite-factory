import css from "./ui.module.css";
import type { FleetStatus } from "../lib/types";

const STAGES = [
  { key: "research", label: "RSCH" },
  { key: "build", label: "BUILD" },
  { key: "deploy", label: "SHIP" },
] as const;

function stageIndex(stage: string): number {
  const s = (stage || "").toLowerCase();
  if (s.includes("research")) return 0;
  if (s.includes("build")) return 1;
  if (s.includes("deploy") || s.includes("ship")) return 2;
  return 0;
}

type NodeState = "pending" | "active" | "done" | "blockedNode";

/** Compact research -> build -> deploy pipeline track with QA-gate semantics. */
export function StageTrack({ stage, status }: { stage: string; status: FleetStatus }) {
  const idx = stageIndex(stage);

  function nodeState(i: number): NodeState {
    if (status === "shipped") return "done";
    if (status === "queued") return "pending";
    if (status === "blocked") {
      if (i < idx) return "done";
      if (i === idx) return "blockedNode";
      return "pending";
    }
    // in_progress
    if (i < idx) return "done";
    if (i === idx) return "active";
    return "pending";
  }

  return (
    <div
      className={css.track}
      role="img"
      aria-label={`Pipeline: ${STAGES.map((s) => `${s.label} ${nodeState(STAGES.indexOf(s))}`).join(", ")}`}
    >
      {STAGES.map((s, i) => {
        const state = nodeState(i);
        return (
          <div key={s.key} style={{ display: "contents" }}>
            <div className={`${css.node} ${css[state] ?? ""}`}>
              <span className={css.nodeDot} />
              <span className={css.nodeLabel}>{s.label}</span>
            </div>
            {i < STAGES.length - 1 && (
              <span className={`${css.link} ${nodeState(i + 1) === "done" || (status === "shipped") ? css.filled : ""}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
