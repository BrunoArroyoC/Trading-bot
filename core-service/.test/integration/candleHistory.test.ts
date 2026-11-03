import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { Alpaca } from "@alpacahq/alpaca-trade-api";
import { asc, eq } from "drizzle-orm";
import { db } from "../../src/db/index.ts";
import { candles } from "../../src/db/schema.ts";
import { getTheLast512Bars1H } from "../../src/layers/alpaca/alpacaConnection.ts";
import { BufferCandle } from "../../src/layers/model/candleBuffer.ts";

// Task 1.10: real Postgres (Testcontainers) + fake Alpaca REST (MSW).

const TICKER = "BTC/USD";
const SECOND_TICKER = "ETH/USD";
const HOUR_MS = 60 * 60 * 1000;
// Fixed "now" so the hour math never depends on when the test runs.
const NOW = new Date("2026-10-31T11:31:00.000Z");
const currentHourStart = new Date("2026-10-31T11:00:00.000Z");

// One hourly bar per hour from `start` up to and including the still-open current hour,
// in the JSON shape Alpaca's /v1beta3/crypto/{loc}/bars returns.
function fakeBars(start: Date, end: Date) {
  const bars = [];
  for (let t = start.getTime(); t <= end.getTime(); t += HOUR_MS) {
    bars.push({ t: new Date(t).toISOString(), o: 100, h: 110, l: 90, c: 105.5, v: 1.25, n: 10, vw: 101 });
  }
  return bars;
}

let lastRequestUrl: URL | undefined;
// What the fake Alpaca returns for each requested symbol.
let barsToReturn: (start: Date, symbol: string) => ReturnType<typeof fakeBars>;

const server = setupServer(
  http.get("https://data.alpaca.markets/v1beta3/crypto/:loc/bars", ({ request }) => {
    lastRequestUrl = new URL(request.url);
    const start = new Date(lastRequestUrl.searchParams.get("start")!);
    // Accepts "BTC/USD,ETH/USD" or a repeated symbols= parameter.
    const symbols = lastRequestUrl.searchParams.getAll("symbols").flatMap((s) => s.split(","));
    const bars = Object.fromEntries(symbols.map((symbol) => [symbol, barsToReturn(start, symbol)]));
    return HttpResponse.json({ bars, next_page_token: null });
  }),
);

// Fake keys: every request goes to MSW, and an unmocked request fails the test.
const alpaca = new Alpaca({ keyId: "test-key", secret: "test-secret", paper: true });

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
  // Only Date is faked; real timers keep pg and MSW working.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

beforeEach(async () => {
  await db.delete(candles);
  lastRequestUrl = undefined;
  barsToReturn = (start) => fakeBars(start, currentHourStart);
});

afterEach(() => server.resetHandlers());

afterAll(async () => {
  vi.useRealTimers();
  server.close();
  await db.$client.end();
});

describe("getTheLast512Bars1H", () => {
  test("saves the last 512 closed hours and skips the open one", async () => {
    const bufferCandle = new BufferCandle();
    await getTheLast512Bars1H(alpaca, [TICKER], bufferCandle);

    const saved = await db.select().from(candles).orderBy(asc(candles.openTime));
    expect(saved).toHaveLength(512);
    // The buffer (task 2.1) is loaded with the same 512 candles.
    expect(bufferCandle.getCandles(TICKER)).toHaveLength(512);
    expect(bufferCandle.getCandles(TICKER).at(-1)?.openTime).toEqual(saved.at(-1)?.openTime);
    // Oldest = 512 hours before the current hour; newest = the hour that just closed (10:00).
    expect(saved[0]?.openTime).toEqual(new Date(currentHourStart.getTime() - 512 * HOUR_MS));
    expect(saved.at(-1)?.openTime).toEqual(new Date(currentHourStart.getTime() - HOUR_MS));
    // Prices come back as strings from the numeric columns.
    expect(saved[0]).toMatchObject({ ticker: TICKER, timeframe: "1Hour", close: "105.5", volume: "1.25" });

    // It asked for HISTORY_BARS + 8 spare hours before the current hour.
    expect(lastRequestUrl?.searchParams.get("symbols")).toBe(TICKER);
    expect(new Date(lastRequestUrl!.searchParams.get("start")!)).toEqual(
      new Date(currentHourStart.getTime() - (512 + 8) * HOUR_MS),
    );
  });

  test("running it again updates the same rows instead of duplicating them", async () => {
    const bufferCandle = new BufferCandle();
    await getTheLast512Bars1H(alpaca, [TICKER], bufferCandle);
    await getTheLast512Bars1H(alpaca, [TICKER], bufferCandle);

    const saved = await db.select().from(candles);
    expect(saved).toHaveLength(512);
    expect(bufferCandle.getCandles(TICKER)).toHaveLength(512);
  });

  test("throws and saves nothing when Alpaca returns fewer than 512 closed bars", async () => {
    barsToReturn = () => fakeBars(new Date(currentHourStart.getTime() - 100 * HOUR_MS), currentHourStart);

    const bufferCandle = new BufferCandle();
    await expect(getTheLast512Bars1H(alpaca, [TICKER], bufferCandle)).rejects.toThrow("Expected 512 1H bars");

    const saved = await db.select().from(candles);
    expect(saved).toHaveLength(0);
    expect(bufferCandle.getCandles(TICKER)).toHaveLength(0);
  });

  test("two tickers: one request, 512 saved for each, separate buffers", async () => {
    const bufferCandle = new BufferCandle();
    await getTheLast512Bars1H(alpaca, [TICKER, SECOND_TICKER], bufferCandle);

    const btc = await db.select().from(candles).where(eq(candles.ticker, TICKER));
    const eth = await db.select().from(candles).where(eq(candles.ticker, SECOND_TICKER));
    expect(btc).toHaveLength(512);
    expect(eth).toHaveLength(512);
    // Same hours for both tickers, and neither one pushed the other out of the buffer.
    expect(bufferCandle.getCandles(TICKER)).toHaveLength(512);
    expect(bufferCandle.getCandles(SECOND_TICKER)).toHaveLength(512);
    expect(bufferCandle.getCandles(SECOND_TICKER).every((candle) => candle.ticker === SECOND_TICKER)).toBe(true);
  });

  test("two tickers: if Alpaca leaves one out, startup fails naming it and saves nothing", async () => {
    barsToReturn = (start, symbol) => (symbol === SECOND_TICKER ? [] : fakeBars(start, currentHourStart));

    const bufferCandle = new BufferCandle();
    await expect(getTheLast512Bars1H(alpaca, [TICKER, SECOND_TICKER], bufferCandle)).rejects.toThrow(
      `Expected 512 1H bars for ${SECOND_TICKER}, got 0`,
    );

    // The check runs for every ticker before any upsert, so BTC isn't half-saved either.
    const saved = await db.select().from(candles);
    expect(saved).toHaveLength(0);
  });
});
