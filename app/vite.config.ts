import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("react-router-dom")) return "router";
          if (id.includes("maplibre-gl")) return "maps";
          if (id.includes("/echarts/") || id.includes("node_modules/echarts/")) {
            return "charts";
          }
          return undefined;
        }
      }
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts"
  }
}));
