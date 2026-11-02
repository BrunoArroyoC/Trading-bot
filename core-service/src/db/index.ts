// node-postgres (pg) works on both Bun (the app) and Node (Vitest), unlike drizzle-orm/bun-sql.
import { drizzle } from "drizzle-orm/node-postgres";

export const db = drizzle(process.env.DATABASE_URL!);
