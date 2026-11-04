import { db } from "../../db/index.ts";
import { snapshots } from "../../db/schema.ts";
import type { MarketSnapshot } from "../model/snapshotZod.ts";


// snapshot; the first one stays because Jev may already have it, and the caller must not publish again.
export async function buildSnap(ticker: string, candleClosedTime: Date, degraded: boolean, data: MarketSnapshot) {
  const result = await db.insert(snapshots).values({
    // Same uuid as inside `data`: Jev's decision and orders.snapshotId point to this id (NFR-09).
    id: data.snapshotId,
    ticker: ticker,
    candleCloseTime: candleClosedTime,
    degraded: degraded,
    // The object, not a string: a string would be stored as a JSON string instead of a jsonb object.
    data: data,
  })
    // Needs the unique index on (ticker, candle_close_time) in schema.ts.
    .onConflictDoNothing({ target: [snapshots.ticker, snapshots.candleCloseTime] })
    .returning({ id: snapshots.id });

  return { inserted: result.length === 1 };
}
