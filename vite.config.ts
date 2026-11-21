import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: "client",
  // Load VITE_* from the repo-root .env (server dotenv also uses that file).
  envDir: repoRoot,
  plugins: [react()],
  resolve: { alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") } },
  build: { outDir: "../dist/client", emptyOutDir: true },
  server: {
    host: true,
    port: 5101,
    strictPort: true,
    allowedHosts: ["hrms.complynz.com"],
    proxy: { "/api": "http://127.0.0.1:5100" },
  },
});
