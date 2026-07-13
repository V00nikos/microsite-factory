import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config for the Microsite Factory operator console.
// - SPA build output in `dist/` (deployed to Cloudflare Pages).
// - `functions/` is NOT bundled by Vite; Cloudflare Pages builds those separately.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2022",
  },
});
