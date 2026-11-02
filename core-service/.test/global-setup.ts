import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { TestProject } from "vitest/node";

let container: StartedPostgreSqlContainer;

export default async function setup(project: TestProject) {
  // Same image as docker-compose, so tests use the same Postgres version.
  try {
    container = await new PostgreSqlContainer("pgvector/pgvector:0.8.7-pg18-trixie").start();
  } catch (err) {
    // Vitest can crash while printing a globalSetup error, so print the cause first.
    console.error(`\nIntegration tests need Docker: ${String(err)}\n` +
      "Is Docker running, and can your user use it without sudo?\n" +
      "Unit tests only: bun run test --project unit\n");
    throw err;
  }
  const url = container.getConnectionUri();

  // The container starts empty: create the tables from drizzle/.
  const db = drizzle(url);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.$client.end();

  // Tests read it with inject("DATABASE_URL").
  project.provide("DATABASE_URL", url);

  return async () => {
    await container.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    DATABASE_URL: string;
  }
}
