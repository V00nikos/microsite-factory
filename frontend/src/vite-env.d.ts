/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Convex deployment URL, e.g. https://your-deployment.convex.cloud. Client-safe. */
  readonly VITE_CONVEX_URL?: string;
  /** "true" to run the board on simulated demo data instead of Convex. Never in prod. */
  readonly VITE_DEMO_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
