import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: parseInt(process.env.VITE_PORT || "5032"),
    strictPort: true,
    allowedHosts: [
      "uxprotos-lnx.cisco.com",
      "localhost",
      "127.0.0.1",
      ".railway.app", // Allow all Railway subdomains
      ".up.railway.app", // Allow Railway production domains
      ".onrender.com", // Allow Render domains
    ],
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
