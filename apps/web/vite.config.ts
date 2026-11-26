import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One build for the React app (static assets) and the Worker (worker/index.ts).
// Local dev keeps the AI binding local, so live readings fail there; set
// COUNTERCHECK_REMOTE_AI=1 to use the real Workers AI, which spends the account's neurons.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({ remoteBindings: process.env.COUNTERCHECK_REMOTE_AI === "1" }),
  ],
  build: { target: "es2022" },
});
