import css from "./ui.module.css";
import type { FleetStatus } from "../lib/types";

const LABELS: Record<FleetStatus, string> = {
  queued: "Queued",
  in_progress: "In flight",
  blocked: "Blocked",
  shipped: "Shipped",
};

function Icon({ status }: { status: FleetStatus }) {
  if (status === "in_progress") {
    return <span className={css.idot} aria-hidden="true" />;
  }
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (status === "shipped") {
    return (
      <svg {...common}>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (status === "blocked") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M15 9l-6 6M9 9l6 6" />
      </svg>
    );
  }
  // queued
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function StatusPill({ status }: { status: FleetStatus }) {
  return (
    <span className={`${css.pill} ${css[status]}`}>
      <Icon status={status} />
      {LABELS[status] ?? status}
    </span>
  );
}
