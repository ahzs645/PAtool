import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, ".", "");
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8787";

  return {
    base: command === "build" ? "./" : "/",
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true
        }
      }
    },
    build: {
      chunkSizeWarningLimit: 1100,
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
  };
});
