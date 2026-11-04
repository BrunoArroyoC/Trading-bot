import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  decisionSchema,
  indicatorSchema,
  KronosForecastSchema,
  MarketSnapshotSchema,
  sentimentSchema,
} from "../../src/layers/model/snapshotZod.ts";
import { IndicatorsOp } from "../../src/layers/indicatorMaths/indicatorsOpe.ts";
import type { Candle } from "../../src/layers/alpaca/model/candleZod.ts";

// Task 2.3: every sample in contracts/ (repo root, shared by all services) parses with core's schema.

// .test/contracts/ -> core-service/ -> repo root.
const CONTRACTS_DIR = new URL("../../../contracts/", import.meta.url);

function readSample(file: string): unknown {
  return JSON.parse(readFileSync(new URL(file, CONTRACTS_DIR), "utf8"));
}

// Deep copy of a sample so a test can break one field without touching the others.
function sampleCopy(file: string): Record<string, unknown> {
  return structuredClone(readSample(file)) as Record<string, unknown>;
}

describe("contract samples parse with their schema", () => {
  test.each([
    ["market-snapshot.v1.json", MarketSnapshotSchema],
    ["market-snapshot-degraded.v1.json", MarketSnapshotSchema],
    ["decision.v1.json", decisionSchema],
    ["kronos-forecast.v1.json", KronosForecastSchema],
    ["sentiment.v1.json", sentimentSchema],
  ] as const)("%s", (file, schema) => {
    const result = schema.safeParse(readSample(file));

    // On failure, the Zod issues show which field broke the contract.
    expect(result.error?.issues).toBeUndefined();
    expect(result.success).toBe(true);
  });
});

describe("schemas reject what breaks the contract", () => {
  test("a snapshot with an indicator that isn't ready (null) is rejected, so no snapshot means HOLD", () => {
    const snapshot = sampleCopy("market-snapshot.v1.json");
    (snapshot.indicators as Record<string, unknown>).ema3 = null;

    expect(MarketSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  test("a negative MACD is valid (it is negative half the time)", () => {
    const snapshot = sampleCopy("market-snapshot.v1.json");
    (snapshot.indicators as { macd: { macd: number } }).macd.macd = -23.37;

    expect(MarketSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  test("an unknown schemaVersion is rejected", () => {
    const snapshot = sampleCopy("market-snapshot.v1.json");
    snapshot.schemaVersion = 2;

    expect(MarketSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  test("a decision action other than BUY / SELL / HOLD is rejected (long-only, no SHORT)", () => {
    const decision = sampleCopy("decision.v1.json");
    decision.action = "SHORT";

    expect(decisionSchema.safeParse(decision).success).toBe(false);
  });

  test("a decision confidence above 1 is rejected", () => {
    const decision = sampleCopy("decision.v1.json");
    decision.confidence = 1.5;

    expect(decisionSchema.safeParse(decision).success).toBe(false);
  });

  test("a sentiment score outside -1..1 is rejected", () => {
    const sentiment = sampleCopy("sentiment.v1.json");
    sentiment.score = -1.2;

    expect(sentimentSchema.safeParse(sentiment).success).toBe(false);
  });
});

describe("indicatorSchema matches what flowIndicator really returns", () => {
  const HOUR_MS = 60 * 60 * 1000;
  const FIRST_HOUR = new Date("2026-10-10T00:00:00.000Z").getTime();

  function candlesFor(count: number): Candle[] {
    return Array.from({ length: count }, (_, hour) => {
      const close = 100 + 20 * Math.sin(hour / 5);
      return {
        ticker: "BTC/USD",
        timeframe: "1Hour",
        openTime: new Date(FIRST_HOUR + hour * HOUR_MS),
        open: String(close),
        high: String(close + 10),
        low: String(close - 10),
        close: String(close),
        volume: "1",
      };
    });
  }

  test("a full buffer (512 candles) parses", () => {
    const result = new IndicatorsOp().flowIndicator("BTC/USD", candlesFor(512));

    expect(indicatorSchema.safeParse(result).error?.issues).toBeUndefined();
  });

  test("a short buffer (EMA 200 still null) does not parse", () => {
    const result = new IndicatorsOp().flowIndicator("BTC/USD", candlesFor(50));

    expect(indicatorSchema.safeParse(result).success).toBe(false);
  });
});
