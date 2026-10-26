import { describe, expect, test } from "vitest";
import { CandleSchema, mapperCandle, type Candle } from "../../src/layers/alpaca/model/candleZod.ts";

// A real bar received from the Alpaca crypto websocket.
const bar = {
  symbol: "BTC/USD",
  open: 80492.3,
  high: 80492.4,
  low: 80476.1,
  close: 80476.15,
  volume: 0.03395711,
  timestamp: new Date("2026-10-25T11:59:00.000Z"),
  timestampRaw: "2026-10-25T11:59:00.000000000Z",
  vwap: 80482.3180677331,
  tradeCount: 35,
};

const badBar = {
  symbol: "BTC/USD",
  open: 80492.3,
  high: -80492.4,
  low: 80476.1,
  close: 80476.15,
  volume: 0.03395711,
  timestamp: new Date("2026-10-25T11:59:00.000Z"),
  timestampRaw: "2026-10-25T11:59:00.000000000Z",
  vwap: 80482.3180677331,
  tradeCount: 35,
};



// The websocket uses symbol/timestamp, the schema uses ticker/openTime.
const input = {
  ticker: bar.symbol,
  timeframe: "1Min",
  openTime: bar.timestamp,
  open: bar.open,
  high: bar.high,
  low: bar.low,
  close: bar.close,
  volume: bar.volume,
};

describe("CandleSchema", () => {
  test("accepts a websocket bar and converts prices to strings", () => {
    const candle = CandleSchema.parse(input);

    expect(candle).toEqual({
      ticker: "BTC/USD",
      timeframe: "1Min",
      openTime: new Date("2026-10-25T11:59:00.000Z"),
      open: "80492.3",
      high: "80492.4",
      low: "80476.1",
      close: "80476.15",
      volume: "0.03395711",
    });
  });

  test("rejects an empty ticker", () => {
    const result = CandleSchema.safeParse({ ...input, ticker: "" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("ticker is required");
  });

  test("rejects a negative price", () => {
    const result = CandleSchema.safeParse({ ...input, open: -1 });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("open must be greater than 0");
  });

  test("rejects high lower than low", () => {
    const result = CandleSchema.safeParse({ ...input, high: 1 });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("high must be greater than or equal to low");
  });

  test("rejects a missing openTime", () => {
    const withoutTime: Partial<typeof input> = { ...input };
    delete withoutTime.openTime;
    const result = CandleSchema.safeParse(withoutTime);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["openTime"]);
  });
});


describe("Mapper for one candle ", () => {
  test("Accept a candle type from the Alpaca endpoints", () => {
    const candle = mapperCandle(bar, "BTC/USD");
    expect(candle).toEqual({
      ticker: "BTC/USD",
      timeframe: "1Hour",
      openTime: new Date("2026-10-25T11:59:00.000Z"),
      open: "80492.3",
      high: "80492.4",
      low: "80476.1",
      close: "80476.15",
      volume: "0.03395711",
    });
  });

  test("Reject a bad bar from Alpaca ", () => {
    expect(() => mapperCandle(badBar, "BTC/USD")).toThrow("high must be greater than 0");
  })



});
