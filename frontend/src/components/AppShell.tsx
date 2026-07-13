import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import css from "./AppShell.module.css";
import { useFleet } from "../hooks/FleetProvider";
import { useTheme } from "../lib/theme";

const TABS = [
  { to: "/", label: "Fleet Board", num: "01", end: true },
  { to: "/intake", label: "Intake", num: "02", end: false },
  { to: "/preview", label: "Preview", num: "03", end: false },
  { to: "/brief", label: "Brief Agency", num: "04", end: false },
];

/** Factory glyph — a small skyline mark, echoing the reference header. */
function FactoryMark() {
  return (
    <div className={css.mark} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 20h18M5 20V9l5 3V9l5 3V6l4 2v12" />
      </svg>
    </div>
  );
}

function ConnectionBadge() {
  const { source, loading } = useFleet();
  const label =
    source === "convex"
      ? loading
        ? "Connecting"
        : "Live · Convex"
      : source === "demo"
        ? "Demo feed"
        : "No source";
  const cls =
    source === "convex" ? css.live : source === "demo" ? css.demo : css.off;
  const title =
    source === "convex"
      ? "Reading live from Convex"
      : source === "demo"
        ? "Simulated demo data"
        : "No VITE_CONVEX_URL configured";
  return (
    <span className={`${css.conn} ${cls}`} title={title}>
      <span className={css.connDot} />
      {label}
    </span>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <time className={css.clock} dateTime={now.toISOString()}>
      {now.toLocaleTimeString([], { hour12: false })}
    </time>
  );
}

const SUN = (
  <>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
  </>
);
const MOON = <path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z" />;

function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      className={css.themeBtn}
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {theme === "dark" ? SUN : MOON}
      </svg>
    </button>
  );
}

export function AppShell() {
  return (
    <div className={css.shell}>
      <header className={css.topbar}>
        <div className={css.brand}>
          <FactoryMark />
          <div className={css.wordmark}>
            <b>Microsite Factory</b>
            <span>Fleet Control</span>
          </div>
        </div>

        <nav className={css.nav} aria-label="Primary">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `${css.tab} ${isActive ? css.tabActive : ""}`
              }
            >
              <span className={css.tabNum}>{t.num}</span>
              <span className={css.tabLabel}>{t.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={css.status}>
          <ConnectionBadge />
          <Clock />
          <ThemeToggle />
        </div>
      </header>

      <main className={css.content}>
        <Outlet />
      </main>
    </div>
  );
}
