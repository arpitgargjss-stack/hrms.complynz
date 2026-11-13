import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  root: "client",
  plugins: [react()],
  resolve: { alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") } },
  build: { outDir: "../dist/client", emptyOutDir: true },
  server: { port: 5101, proxy: { "/api": "http://localhost:5100" } },
});
