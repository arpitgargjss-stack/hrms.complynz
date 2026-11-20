import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  root: "client",
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
