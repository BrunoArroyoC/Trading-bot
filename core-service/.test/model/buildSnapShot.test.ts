import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  buildSnapShot,
  MarketSnapshotSchema,
  type Indicator,
  type KronosForeceast,
  type Sentiment,
  type SnapshotCandle,
} from "../../src/layers/model/snapshotZod.ts";

// Task 2.4: complete, degraded (no Kronos) and stale (old sentiment) snapshots.

const TICKER = "BTC/USD";
const HOUR_MS = 60 * 60 * 1000;
// The 17:00 candle closes at 18:00; the cron builds the snapshot at 18:01.
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

const kronos: KronosForeceast = { schemaVersion: 1, horizonHours: 6, predictedClose: 77610, volatility: 0.011 };

// Sentiment generated `minutesAgo` before NOW.
function sentimentFrom(minutesAgo: number): Sentiment {
  return {
    schemaVersion: 1,
    score: 0.35,
    confidence: 0.6,
    keyDrivers: ["ETF inflows"],
    generatedAt: new Date(NOW.getTime() - minutesAgo * 60 * 1000).toISOString(),
  };
}

beforeAll(() => {
  // Only Date is faked, so `stale` doesn't depend on when the test runs.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterAll(() => vi.useRealTimers());

describe("buildSnapShot", () => {
  test("complete: Kronos and fresh sentiment, not degraded, not stale", () => {
    const snapshot = buildSnapShot(TICKER, CANDLE_CLOSE_TIME, candle, indicator, kronos, sentimentFrom(31));

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      ticker: TICKER,
      candleCloseTime: "2026-11-03T18:00:00.000Z",
      candle,
      indicators: indicator,
      // The forecast goes in without Kronos's own schemaVersion.
      forecast: { horizonHours: 6, predictedClose: 77610, volatility: 0.011 },
      sentiment: { score: 0.35, confidence: 0.6, keyDrivers: ["ETF inflows"], stale: false },
      degraded: false,
    });
    expect(snapshot.forecast).not.toHaveProperty("schemaVersion");
    expect(snapshot.sentiment).not.toHaveProperty("schemaVersion");
  });

  test("the result is a valid MarketSnapshot (what goes to the DB and the queue)", () => {
    const snapshot = buildSnapShot(TICKER, CANDLE_CLOSE_TIME, candle, indicator, kronos, sentimentFrom(31));

    expect(MarketSnapshotSchema.safeParse(snapshot).success).toBe(true);
    // Survives the JSON round trip (jsonb column, RabbitMQ) unchanged.
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  test("degraded: no Kronos gives forecast null and degraded true, the rest still there", () => {
    const snapshot = buildSnapShot(TICKER, CANDLE_CLOSE_TIME, candle, indicator, undefined, sentimentFrom(31));

    expect(snapshot.forecast).toBeNull();
    expect(snapshot.degraded).toBe(true);
    expect(snapshot.indicators).toEqual(indicator);
    expect(snapshot.sentiment?.stale).toBe(false);
  });

  test("stale: sentiment 3 hours old is marked stale", () => {
    const snapshot = buildSnapShot(TICKER, CANDLE_CLOSE_TIME, candle, indicator, kronos, sentimentFrom(180));

    expect(snapshot.sentiment?.stale).toBe(true);
    // Old sentiment alone doesn't make the snapshot degraded; only a missing forecast does.
    expect(snapshot.degraded).toBe(false);
  });

  test("stale limit: exactly 2 hours is still fresh, 2 hours and 1 minute is stale", () => {
    expect(buildSnapShot(TICKER, CANDLE_CLOSE_TIME, candle, indicator, kronos, sentimentFrom(120)).sentiment?.stale).toBe(false);
    expect(buildSnapShot(TICKER, CANDLE_CLOSE_TIME, candle, indicator, kronos, sentimentFrom(121)).sentiment?.stale).toBe(true);
  });

  test("no sentiment in Redis gives sentiment null", () => {
    const snapshot = buildSnapShot(TICKER, CANDLE_CLOSE_TIME, candle, indicator, kronos);

    expect(snapshot.sentiment).toBeNull();
    expect(snapshot.degraded).toBe(false);
  });

  test("neither Kronos nor sentiment still builds a degraded snapshot", () => {
    const snapshot = buildSnapShot(TICKER, CANDLE_CLOSE_TIME, candle, indicator);

    expect(snapshot).toMatchObject({ forecast: null, sentiment: null, degraded: true });
  });

  test("every snapshot gets its own uuid (it becomes the Alpaca client_order_id)", () => {
    const first = buildSnapShot(TICKER, CANDLE_CLOSE_TIME, candle, indicator, kronos);
    const second = buildSnapShot(TICKER, CANDLE_CLOSE_TIME, candle, indicator, kronos);

    expect(first.snapshotId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.snapshotId).not.toBe(first.snapshotId);
  });

  test("an indicator that isn't ready (null) throws, so no snapshot is built (HOLD)", () => {
    // flowIndicator returns null for EMA 200 with fewer than 200 candles.
    const notReady = { ...indicator, ema3: null } as unknown as Indicator;

    expect(() => buildSnapShot(TICKER, CANDLE_CLOSE_TIME, candle, notReady, kronos)).toThrow();
  });

  test("a bad candle (negative price) throws", () => {
    expect(() => buildSnapShot(TICKER, CANDLE_CLOSE_TIME, { ...candle, close: -1 }, indicator, kronos)).toThrow();
  });

  test("candleCloseTime is the close of the candle, sent as an ISO string", () => {
    // The buffer's newest candle opened at 17:00; its close is openTime + 1 hour.
    const openTime = new Date("2026-11-03T17:00:00.000Z");
    const snapshot = buildSnapShot(TICKER, new Date(openTime.getTime() + HOUR_MS), candle, indicator, kronos);

    expect(snapshot.candleCloseTime).toBe("2026-11-03T18:00:00.000Z");
  });
});
