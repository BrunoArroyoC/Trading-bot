import { db } from "../../db/index.ts";
import { candles } from "../../db/schema.ts"
import type { Candle } from "./model/candleZod.ts";
import { eq, max, sql } from "drizzle-orm";

//Upsert UPDATE AND CREATE

export async function upsertCandle(row: Candle[]) {
  if (row.length === 0) return { inserted: 0, updated: 0 };
  const result =  await db.insert(candles).values(row).onConflictDoUpdate({
    target: [candles.ticker, candles.timeframe, candles.openTime],
    set: {
      open: sql`excluded.open`,
      high: sql`excluded.high`,
      low: sql`excluded.low`,
      close: sql`excluded.close`,
      volume: sql`excluded.volume`,
    }
  }).returning({ inserted: sql<boolean>`(xmax = 0)` });

  const inserted = result.filter((r) => r.inserted).length;
  return { inserted, updated: result.length - inserted };
}

export async function extractTimeLastClosedCandle(ticker: string) {
  const result = await db.select({ openTime: max(candles.openTime) }).from(candles).where(eq(candles.ticker, ticker));
  return result;
}
