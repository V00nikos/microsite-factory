import { ConvexReactClient } from "convex/react";

// Client is created from VITE_CONVEX_URL, falling back to the deployed factory
// deployment's public client URL (not a secret — it's the browser-facing Convex
// endpoint) so the console connects even when the build-time env var is unset.
// When absent, the app still renders (board shows an "unconfigured" notice).
const DEFAULT_CONVEX_URL = "https://enchanted-stingray-115.convex.cloud";
const raw = (import.meta.env.VITE_CONVEX_URL as string | undefined) ?? DEFAULT_CONVEX_URL;
export const convexUrl = raw && raw.trim() ? raw.trim() : null;

export const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;
