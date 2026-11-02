import { inject } from "vitest";

// Runs before each integration test file is imported. src/db/index.ts reads DATABASE_URL
// on import, and `bun run test` has already loaded the real one from .env, so replace it
// with the container's URL here; the real database is never touched.
process.env.DATABASE_URL = inject("DATABASE_URL");
