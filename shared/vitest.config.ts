import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // A few tests process the large committed PAT fixtures; the default 5s
    // timeout sits right at their edge and flakes under load. Give headroom.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
