import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5012,
    strictPort: true,
    allowedHosts: ["uxprotos-lnx.cisco.com", "localhost", "127.0.0.1"],
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
