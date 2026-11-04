import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/index.ts";
import { snapshots } from "../../src/db/schema.ts";
import { buildSnap } from "../../src/layers/repository/utilsRepository.ts";
import {
  buildSnapShot,
  MarketSnapshotSchema,
  type Indicator,
  type SnapshotCandle,
} from "../../src/layers/model/snapshotZod.ts";

// Task 2.5: snapshots in Postgres (Testcontainers), exactly one row per ticker per hour.

const TICKER = "BTC/USD";
const SECOND_TICKER = "ETH/USD";
const HOUR_MS = 60 * 60 * 1000;
const CANDLE_CLOSE_TIME = new Date("2026-11-03T18:00:00.000Z");
const NOW = new Date("2026-11-03T18:01:00.000Z");

const candle: SnapshotCandle = { open: 77020.5, high: 77410, low: 76880.25, close: 77250.75, volume: 92.41 };

const indicator: Indicator = {
  rsi: 61.4,
  macd: { histogram: 137.37, macd: 23.37, signal: -114 },
  atr: 396.83,
  ema1: 77132.56,
  ema2: 77311.87,
  ema3: 78507.74,
  sma: 89.09,
  bollinger: { lower: 76258.66, middle: 76924.11, upper: 77589.55 },
};

// A snapshot for `ticker` whose candle closes at `closeTime`; no Kronos, so it is degraded.
function snapshotFor(ticker = TICKER, closeTime = CANDLE_CLOSE_TIME) {
  return buildSnapShot(ticker, closeTime, candle, indicator);
}

// Saves it the way the app will: the columns come from the snapshot itself.
function save(snapshot: ReturnType<typeof snapshotFor>) {
  return buildSnap(snapshot.ticker, new Date(snapshot.candleCloseTime), snapshot.degraded, snapshot);
}

beforeAll(() => {
  // Only Date is faked; real timers keep pg working.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

beforeEach(async () => {
  await db.delete(snapshots);
});

afterAll(async () => {
  vi.useRealTimers();
  await db.$client.end();
});

describe("buildSnap", () => {
  test("saves one row; its id is the snapshotId inside data", async () => {
    const snapshot = snapshotFor();

    const { inserted } = await save(snapshot);

    const rows = await db.select().from(snapshots);
    expect(inserted).toBe(true);
    expect(rows).toHaveLength(1);
    // Same uuid in both places, so a Decision's snapshotId finds this row (NFR-09).
    expect(rows[0]?.id).toBe(snapshot.snapshotId);
    expect(rows[0]).toMatchObject({ ticker: TICKER, candleCloseTime: CANDLE_CLOSE_TIME, degraded: true });
  });

  test("data comes back as the same object (jsonb), still a valid MarketSnapshot", async () => {
    const snapshot = snapshotFor();
    await save(snapshot);

    const [row] = await db.select().from(snapshots);

    // An object, not a JSON string: a string here would mean it was stored with quotes.
    expect(typeof row?.data).toBe("object");
    expect(row?.data).toEqual(snapshot);
    expect(MarketSnapshotSchema.safeParse(row?.data).success).toBe(true);
  });

  test("the same ticker and hour twice keeps exactly one row: the first one", async () => {
    const first = snapshotFor();
    const second = snapshotFor(); // same hour, new snapshotId (e.g. a restart at 18:01:30)

    const firstResult = await save(first);
    const secondResult = await save(second);

    const rows = await db.select().from(snapshots);
    expect(firstResult.inserted).toBe(true);
    // false tells the caller not to publish the second one to Jev.
    expect(secondResult.inserted).toBe(false);
    expect(rows).toHaveLength(1);
    // The first stays because Jev may already have it.
    expect(rows[0]?.id).toBe(first.snapshotId);
  });

  test("next hour is a new row", async () => {
    await save(snapshotFor(TICKER, CANDLE_CLOSE_TIME));
    const nextHour = await save(snapshotFor(TICKER, new Date(CANDLE_CLOSE_TIME.getTime() + HOUR_MS)));

    expect(nextHour.inserted).toBe(true);
    expect(await db.select().from(snapshots)).toHaveLength(2);
  });

  test("two tickers in the same hour get one row each", async () => {
    const btc = await save(snapshotFor(TICKER));
    const eth = await save(snapshotFor(SECOND_TICKER));

    expect(btc.inserted).toBe(true);
    expect(eth.inserted).toBe(true);
    expect(await db.select().from(snapshots).where(eq(snapshots.ticker, TICKER))).toHaveLength(1);
    expect(await db.select().from(snapshots).where(eq(snapshots.ticker, SECOND_TICKER))).toHaveLength(1);
  });

  test("a day of hourly runs, each run twice, leaves exactly 24 rows", async () => {
    for (let hour = 0; hour < 24; hour++) {
      const closeTime = new Date(CANDLE_CLOSE_TIME.getTime() + hour * HOUR_MS);
      await save(snapshotFor(TICKER, closeTime));
      await save(snapshotFor(TICKER, closeTime));
    }

    expect(await db.select().from(snapshots)).toHaveLength(24);
  });
});
