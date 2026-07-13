import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";

import "@fontsource-variable/archivo/index.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-mono/700.css";
import "./styles/global.css";

import { App } from "./App";
import { convexClient } from "./convex";
import { FleetProvider } from "./hooks/FleetProvider";
import { ToastProvider } from "./components/Toast";
import { initTheme } from "./lib/theme";

// Set the theme attribute before first paint (avoids a flash of wrong theme).
initTheme();

/** Mount ConvexProvider only when a client exists (VITE_CONVEX_URL set). */
function ConvexMaybe({ children }: { children: ReactNode }) {
  if (convexClient) return <ConvexProvider client={convexClient}>{children}</ConvexProvider>;
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexMaybe>
      <ToastProvider>
        <FleetProvider>
          <App />
        </FleetProvider>
      </ToastProvider>
    </ConvexMaybe>
  </StrictMode>
);
