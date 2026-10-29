import type { Bar } from "@alpacahq/alpaca-trade-api";
import { describe, expect, test } from "vitest";
import { addBarToHour, convertToHourCandle } from "../../src/layers/alpaca/model/candleZod.ts";

const MINUTE_MS = 60 * 1000;
const HOUR_START = Date.parse("2026-10-29T18:00:00.000Z");

// Minute i of the 18:00 hour. Prices rise by 1 each minute, so:
// open of minute 0 = 150, close of minute 59 = 210, lowest low = 100, highest high = 259.
function minuteBar(i: number, start = HOUR_START): Bar {
  return {
    symbol: "BTC/USD",
    timestamp: new Date(start + i * MINUTE_MS),
    open: 150 + i,
    high: 200 + i,
    low: 100 + i,
    close: 151 + i,
    volume: 0.1,
  };
}

function fullHour(start = HOUR_START): Bar[] {
  return Array.from({ length: 60 }, (_, i) => minuteBar(i, start));
}

describe("convertToHourCandle", () => {
  describe("normal hour", () => {
    test("aggregates 60 minute bars into one 1H candle", () => {
      const result = convertToHourCandle(fullHour(), "BTC/USD");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candle).toEqual({
        ticker: "BTC/USD",
        timeframe: "1Hour",
        openTime: new Date("2026-10-29T18:00:00.000Z"),
        open: "150", // first minute's open
        high: "259", // highest high
        low: "100", // lowest low
        close: "210", // last minute's close
        volume: "6", // 60 × 0.1, without float noise
      });
    });

    test("does not modify the input bars", () => {
      const bars = fullHour();
      const copy = structuredClone(bars);

      convertToHourCandle(bars, "BTC/USD");

      expect(bars).toEqual(copy);
    });
  });

  describe("missing minute", () => {
    test("still builds the candle when a minute in the middle is missing", () => {
      const bars = fullHour().filter((bar) => bar.timestamp.getUTCMinutes() !== 30);

      const result = convertToHourCandle(bars, "BTC/USD");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candle.openTime).toEqual(new Date("2026-10-29T18:00:00.000Z"));
      expect(result.candle.volume).toBe("5.9");
    });

    test("keeps openTime at the start of the hour when the first minute is missing", () => {
      const bars = fullHour().slice(1); // 18:01 … 18:59

      const result = convertToHourCandle(bars, "BTC/USD");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candle.openTime).toEqual(new Date("2026-10-29T18:00:00.000Z"));
      expect(result.candle.open).toBe("151"); // open of 18:01, the first bar that exists
      expect(result.candle.low).toBe("101");
    });

    test("returns ok: false for an empty hour", () => {
      const result = convertToHourCandle([], "BTC/USD");

      expect(result.ok).toBe(false);
    });
  });

  describe("hour boundary", () => {
    test("a bar at 18:59 belongs to the 18:00 candle", () => {
      const result = convertToHourCandle(fullHour(), "BTC/USD");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candle.openTime).toEqual(new Date("2026-10-29T18:00:00.000Z"));
    });

    test("bars starting at 19:00 give the 19:00 candle, not 18:00", () => {
      const nextHour = HOUR_START + 60 * MINUTE_MS;

      const result = convertToHourCandle(fullHour(nextHour), "BTC/USD");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candle.openTime).toEqual(new Date("2026-10-29T19:00:00.000Z"));
    });

  });
});

describe("addBarToHour", () => {
  test("the first bar starts the current hour", () => {
    const result = addBarToHour([], minuteBar(0));

    expect(result.currentHour).toEqual([minuteBar(0)]);
    expect(result.closedHour).toBeNull();
  });

  test("a bar from the same hour joins the current hour", () => {
    const result = addBarToHour([minuteBar(58)], minuteBar(59));

    expect(result.currentHour).toEqual([minuteBar(58), minuteBar(59)]);
    expect(result.closedHour).toBeNull();
  });

  test("the 19:00 bar closes the 18:00 hour and starts a new one", () => {
    const at1900 = minuteBar(60); // 60 minutes after 18:00

    const result = addBarToHour([minuteBar(58), minuteBar(59)], at1900);

    expect(result.closedHour).toEqual([minuteBar(58), minuteBar(59)]);
    expect(result.currentHour).toEqual([at1900]);
  });

  test("closes the hour even when minutes are missing", () => {
    const withGap = [minuteBar(10), minuteBar(40)];

    const result = addBarToHour(withGap, minuteBar(61)); // 19:01, 19:00 is missing

    expect(result.closedHour).toEqual(withGap);
    expect(result.currentHour).toEqual([minuteBar(61)]);
  });

  test("ignores a late bar from an hour that is already closed", () => {
    const current = [minuteBar(60)]; // collecting 19:00

    const result = addBarToHour(current, minuteBar(59)); // 18:59 arrives late

    expect(result.currentHour).toEqual(current);
    expect(result.closedHour).toBeNull();
  });

  test("does not modify the input queue", () => {
    const current = [minuteBar(58)];

    addBarToHour(current, minuteBar(59));

    expect(current).toEqual([minuteBar(58)]);
  });
});
