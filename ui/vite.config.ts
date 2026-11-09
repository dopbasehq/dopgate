import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

// Dates render in the browser's locale, and tests assert US-style text.
// Node takes its default locale from LANG/LC_ALL when a process starts, so
// set them here, before Vitest forks its workers.
if (process.env.VITEST) {
  process.env.LC_ALL = "en_US.UTF-8";
  process.env.LANG = "en_US.UTF-8";
}

// The dopgate server the dev proxy talks to. Override for another port.
const backend = process.env.DOPGATE_API_URL ?? "http://localhost:8850";

// https://vite.dev/config/
export default defineConfig({
  // dopgate serves the console root-mounted from ui/dist (rust-embed), so
  // assets must use absolute URLs; relative ones break on nested routes.
  base: "/",
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    // The server's CSP allows images and fonts from 'self' only, so Vite must
    // not inline small assets as data: URIs.
    assetsInlineLimit: 0,
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": { target: backend, changeOrigin: true },
      "/.well-known": { target: backend, changeOrigin: true },
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
