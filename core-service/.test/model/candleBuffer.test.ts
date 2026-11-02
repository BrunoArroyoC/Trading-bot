import { beforeEach, describe, expect, test } from "vitest";
import { BufferCandle } from "../../src/layers/model/candleBuffer.ts";
import type { Candle } from "../../src/layers/alpaca/model/candleZod.ts";

// Task 2.1: the buffer grows by one candle per hour and never exceeds 512.

const HOUR_MS = 60 * 60 * 1000;
const FIRST_HOUR = new Date("2026-10-10T00:00:00.000Z").getTime();

// Candle number `hour` = FIRST_HOUR + hour hours.
function candleAt(hour: number, close = "100"): Candle {
  return {
    ticker: "BTC/USD",
    timeframe: "1Hour",
    openTime: new Date(FIRST_HOUR + hour * HOUR_MS),
    open: "100",
    high: "110",
    low: "90",
    close,
    volume: "1",
  };
}

function openTimes(bufferCandle: BufferCandle) {
  return bufferCandle.bufferCandle.map((candle) => candle.openTime.getTime());
}

let bufferCandle: BufferCandle;

beforeEach(() => {
  // Same as startup: 512 candles, hours 0..511.
  bufferCandle = new BufferCandle();
  for (let hour = 0; hour < 512; hour++) bufferCandle.pushToBuffer(candleAt(hour));
});

describe("BufferCandle.pushToBuffer", () => {
  test("is loaded with 512 candles from oldest to newest", () => {
    expect(bufferCandle.bufferCandle).toHaveLength(512);
    expect(bufferCandle.bufferCandle[0]?.openTime).toEqual(candleAt(0).openTime);
    expect(bufferCandle.bufferCandle.at(-1)?.openTime).toEqual(candleAt(511).openTime);
  });

  test("a new hour goes in at the end and the oldest one goes out", () => {
    bufferCandle.pushToBuffer(candleAt(512));

    expect(bufferCandle.bufferCandle).toHaveLength(512);
    expect(bufferCandle.bufferCandle[0]?.openTime).toEqual(candleAt(1).openTime);
    expect(bufferCandle.bufferCandle.at(-1)?.openTime).toEqual(candleAt(512).openTime);
  });

  test("a normal cron run (lastSaved again + the new hour) adds exactly one hour", () => {
    // auxCandle starts at lastSaved, so its first candle is already in the buffer.
    [candleAt(511), candleAt(512)].forEach((candle) => bufferCandle.pushToBuffer(candle));

    expect(bufferCandle.bufferCandle).toHaveLength(512);
    expect(bufferCandle.bufferCandle.at(-1)?.openTime).toEqual(candleAt(512).openTime);
    // No hour appears twice.
    expect(new Set(openTimes(bufferCandle)).size).toBe(512);
  });

  test("the same hour twice is replaced, not duplicated", () => {
    bufferCandle.pushToBuffer(candleAt(511, "200"));

    expect(bufferCandle.bufferCandle).toHaveLength(512);
    expect(bufferCandle.bufferCandle.at(-1)?.close).toBe("200");
    expect(bufferCandle.bufferCandle.at(-2)?.openTime).toEqual(candleAt(510).openTime);
  });

  test("an older hour is ignored", () => {
    const before = openTimes(bufferCandle);

    bufferCandle.pushToBuffer(candleAt(100, "999"));

    expect(openTimes(bufferCandle)).toEqual(before);
    expect(bufferCandle.bufferCandle.find((candle) => candle.close === "999")).toBeUndefined();
  });

  test("after a gap, every missed hour goes in and it still never exceeds 512", () => {
    // 3 missed hours: the cron gets lastSaved + 512, 513, 514.
    [candleAt(511), candleAt(512), candleAt(513), candleAt(514)].forEach((candle) =>
      bufferCandle.pushToBuffer(candle),
    );

    expect(bufferCandle.bufferCandle).toHaveLength(512);
    expect(bufferCandle.bufferCandle[0]?.openTime).toEqual(candleAt(3).openTime);
    expect(bufferCandle.bufferCandle.at(-1)?.openTime).toEqual(candleAt(514).openTime);
  });

  test("a day of hourly runs keeps it at 512, always ending at the newest hour", () => {
    for (let hour = 512; hour < 512 + 24; hour++) {
      [candleAt(hour - 1), candleAt(hour)].forEach((candle) => bufferCandle.pushToBuffer(candle));
      expect(bufferCandle.bufferCandle).toHaveLength(512);
      expect(bufferCandle.bufferCandle.at(-1)?.openTime).toEqual(candleAt(hour).openTime);
    }
  });

  test("an empty buffer accepts the first candle", () => {
    const emptyBuffer = new BufferCandle();

    emptyBuffer.pushToBuffer(candleAt(0));

    expect(emptyBuffer.bufferCandle).toHaveLength(1);
  });
});
