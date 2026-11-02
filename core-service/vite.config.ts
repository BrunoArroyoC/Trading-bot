import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "forks",
    // Keeps pino quiet so test output stays readable.
    env: { LOG_LEVEL: "silent" },
    // `bun run test` runs both projects; `bun run test --project unit` skips Docker.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: [".test/**/*.test.ts"],
          exclude: [".test/integration/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: [".test/integration/**/*.test.ts"],
          // Starts one Postgres container for all integration tests.
          globalSetup: "./.test/global-setup.ts",
          // Points src/db at that container before any test file imports it.
          setupFiles: ["./.test/integration/setup.ts"],
        },
      },
    ],
  },
});
