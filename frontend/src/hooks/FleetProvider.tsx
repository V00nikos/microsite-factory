import {
  Component,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "convex/react";
import { fns } from "../lib/convexApi";
import { convexClient, convexUrl } from "../convex";
import { emptyBoard, normalizeBoard } from "../lib/normalize";
import { createDemoFleet, DEMO_ENABLED } from "../lib/demoData";
import type { FleetBoard } from "../lib/types";

export type FleetSource = "convex" | "demo" | "unconfigured";

export interface FleetContextValue {
  board: FleetBoard;
  loading: boolean;
  source: FleetSource;
  /** Human-readable note when the live query can't be reached / isn't deployed yet. */
  notice: string | null;
}

const FleetContext = createContext<FleetContextValue | null>(null);

export function useFleet(): FleetContextValue {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error("useFleet must be used within <FleetProvider>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Error boundary — a missing/unreachable Convex query throws during   */
/*  render; we catch it and still provide an empty board so the app     */
/*  shell (nav, other screens) keeps working.                           */
/* ------------------------------------------------------------------ */
class QueryErrorBoundary extends Component<
  { children: ReactNode; onError: (msg: string) => ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  render() {
    if (this.state.error) return this.props.onError(this.state.error);
    return this.props.children;
  }
}

/* ---------- Convex-backed provider ---------- */
function ConvexFleetInner({ children }: { children: ReactNode }) {
  const raw = useQuery(fns.fleetBoard);
  const loading = raw === undefined;
  const board = useMemo(() => (loading ? emptyBoard() : normalizeBoard(raw)), [raw, loading]);
  const value: FleetContextValue = {
    board,
    loading,
    source: "convex",
    notice: null,
  };
  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

function ConvexFleetProvider({ children }: { children: ReactNode }) {
  const fallback = (msg: string) => (
    <FleetContext.Provider
      value={{
        board: emptyBoard(),
        loading: false,
        source: "convex",
        notice:
          `Live query unavailable — waiting for the Convex backend. ` +
          `Expected reactive query \`fleet.board\`. (${msg})`,
      }}
    >
      {children}
    </FleetContext.Provider>
  );
  return (
    <QueryErrorBoundary onError={fallback}>
      <ConvexFleetInner>{children}</ConvexFleetInner>
    </QueryErrorBoundary>
  );
}

/* ---------- Demo provider (VITE_DEMO_MODE=true) ---------- */
function DemoFleetProvider({ children }: { children: ReactNode }) {
  const fleetRef = useRef(createDemoFleet());
  const [rows, setRows] = useState(() => fleetRef.current.get());
  useEffect(() => {
    const id = setInterval(() => setRows([...fleetRef.current.tick()]), 1200);
    return () => clearInterval(id);
  }, []);
  const board = useMemo(() => normalizeBoard(rows), [rows]);
  const value: FleetContextValue = {
    board,
    loading: false,
    source: "demo",
    notice: "Demo mode — simulated live fleet (VITE_DEMO_MODE=true). Not reading Convex.",
  };
  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

/* ---------- Unconfigured provider (no VITE_CONVEX_URL) ---------- */
function UnconfiguredFleetProvider({ children }: { children: ReactNode }) {
  const value: FleetContextValue = {
    board: emptyBoard(),
    loading: false,
    source: "unconfigured",
    notice:
      "VITE_CONVEX_URL is not set — the board has no live data source. Set it in .env / build env, or run with VITE_DEMO_MODE=true to preview.",
  };
  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

export function FleetProvider({ children }: { children: ReactNode }) {
  if (DEMO_ENABLED) return <DemoFleetProvider>{children}</DemoFleetProvider>;
  if (convexClient && convexUrl) return <ConvexFleetProvider>{children}</ConvexFleetProvider>;
  return <UnconfiguredFleetProvider>{children}</UnconfiguredFleetProvider>;
}
