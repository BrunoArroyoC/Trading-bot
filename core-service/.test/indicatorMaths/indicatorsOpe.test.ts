import { describe, expect, test } from "vitest";
import { IndicatorsOp } from "../../src/layers/indicatorMaths/indicatorsOpe.ts";
import type { Candle } from "../../src/layers/alpaca/model/candleZod.ts";

// Task 2.2: indicators computed from one ticker's buffer (oldest first).

const TICKER = "BTC/USD";
const SECOND_TICKER = "ETH/USD";
const HOUR_MS = 60 * 60 * 1000;
const FIRST_HOUR = new Date("2026-10-10T00:00:00.000Z").getTime();

// Candle number `hour`. High/low are 10 above/below the close unless given.
function candleAt(hour: number, close: number, volume = 1, ticker = TICKER): Candle {
  return {
    ticker,
    timeframe: "1Hour",
    openTime: new Date(FIRST_HOUR + hour * HOUR_MS),
    open: String(close),
    high: String(close + 10),
    low: String(close - 10),
    close: String(close),
    volume: String(volume),
  };
}

// Builds `count` candles whose close comes from closeAt(hour).
function series(count: number, closeAt: (hour: number) => number, ticker = TICKER): Candle[] {
  return Array.from({ length: count }, (_, hour) => candleAt(hour, closeAt(hour), 1, ticker));
}

// Independent EMA, same formula as trading-signals: seeded with the first price,
// then price * k + previous * (1 - k), with k = 2 / (period + 1).
function emaByHand(prices: number[], period: number): number {
  const k = 2 / (period + 1);
  return prices.reduce((previous, price) => price * k + previous * (1 - k));
}

// A price that goes up and down, so gains and losses both exist.
const zigZag = (hour: number) => 100 + 20 * Math.sin(hour / 5) + hour * 0.1;

const indicatorOp = new IndicatorsOp();

describe("IndicatorsOp.flowIndicator", () => {
  test("no candles: every indicator is null (not enough data means HOLD later)", () => {
    const result = indicatorOp.flowIndicator(TICKER, []);

    expect(result).toMatchObject({
      ticker: TICKER,
      rsi: null,
      macd: null,
      atr: null,
      ema1: null,
      ema2: null,
      ema3: null,
      sma: null,
      bollinger: null,
    });
  });

  test("EMA 200 stays null with 199 candles and appears at 200", () => {
    expect(indicatorOp.flowIndicator(TICKER, series(199, zigZag)).ema3).toBeNull();
    // The shorter ones are already ready with 199.
    expect(indicatorOp.flowIndicator(TICKER, series(199, zigZag)).ema1).not.toBeNull();

    expect(indicatorOp.flowIndicator(TICKER, series(200, zigZag)).ema3).not.toBeNull();
  });

  test("with a full buffer (512) every indicator has a value", () => {
    const result = indicatorOp.flowIndicator(TICKER, series(512, zigZag));

    for (const value of Object.values(result)) expect(value).not.toBeNull();
  });

  test("EMA 20 / 50 / 200 match the formula done by hand", () => {
    const candles = series(512, zigZag);
    const closes = candles.map((candle) => Number(candle.close));

    const result = indicatorOp.flowIndicator(TICKER, candles);

    expect(result.ema1).toBeCloseTo(emaByHand(closes, 20), 8);
    expect(result.ema2).toBeCloseTo(emaByHand(closes, 50), 8);
    expect(result.ema3).toBeCloseTo(emaByHand(closes, 200), 8);
  });

  test("MACD line = EMA 12 - EMA 26, histogram = MACD - signal (each price fed once)", () => {
    const candles = series(512, zigZag);
    const closes = candles.map((candle) => Number(candle.close));

    const macd = indicatorOp.flowIndicator(TICKER, candles).macd;

    // If a price were fed twice, these EMAs would no longer match.
    expect(macd?.macd).toBeCloseTo(emaByHand(closes, 12) - emaByHand(closes, 26), 8);
    expect(macd?.histogram).toBeCloseTo(macd!.macd - macd!.signal, 8);
  });

  test("RSI is 100 when the price only goes up and 0 when it only goes down", () => {
    expect(indicatorOp.flowIndicator(TICKER, series(30, (hour) => 100 + hour)).rsi).toBe(100);
    expect(indicatorOp.flowIndicator(TICKER, series(30, (hour) => 200 - hour)).rsi).toBe(0);
  });

  test("RSI stays between 0 and 100 on a mixed price", () => {
    const rsi = indicatorOp.flowIndicator(TICKER, series(512, zigZag)).rsi;

    expect(rsi).toBeGreaterThan(0);
    expect(rsi).toBeLessThan(100);
  });

  test("ATR uses high and low: a flat close with a 20 range gives ATR 20", () => {
    // high = 110, low = 90, close = 100 every hour, so every true range is 20.
    const atr = indicatorOp.flowIndicator(TICKER, series(30, () => 100)).atr;

    expect(atr).toBeCloseTo(20, 8);
  });

  test("Bollinger on a flat price: all three bands equal the price (no deviation)", () => {
    const bollinger = indicatorOp.flowIndicator(TICKER, series(30, () => 100)).bollinger;

    expect(bollinger?.middle).toBeCloseTo(100, 8);
    expect(bollinger?.upper).toBeCloseTo(100, 8);
    expect(bollinger?.lower).toBeCloseTo(100, 8);
  });

  test("Bollinger middle is the 20-candle average and the bands are symmetric", () => {
    const candles = series(512, zigZag);
    const last20 = candles.slice(-20).map((candle) => Number(candle.close));
    const average = last20.reduce((sum, price) => sum + price, 0) / 20;

    const bollinger = indicatorOp.flowIndicator(TICKER, candles).bollinger;

    expect(bollinger?.middle).toBeCloseTo(average, 8);
    expect(bollinger!.upper - bollinger!.middle).toBeCloseTo(bollinger!.middle - bollinger!.lower, 8);
  });

  test("volume average uses the volume, not the close: last 20 of 1..512 = 502.5", () => {
    // Volume = hour + 1, so the last 20 are 493..512, average (493 + 512) / 2 = 502.5.
    const candles = Array.from({ length: 512 }, (_, hour) => candleAt(hour, 100, hour + 1));

    expect(indicatorOp.flowIndicator(TICKER, candles).sma).toBeCloseTo(502.5, 8);
  });

  test("no state is kept between calls: the same candles give the same result", () => {
    const candles = series(512, zigZag);

    const first = indicatorOp.flowIndicator(TICKER, candles);
    const second = indicatorOp.flowIndicator(TICKER, candles);

    expect(second).toEqual(first);
  });

  test("two tickers don't mix: ETH after BTC gives the same as ETH alone", () => {
    const btc = series(512, zigZag);
    const eth = series(512, (hour) => 3000 + 50 * Math.cos(hour / 7), SECOND_TICKER);

    const ethAlone = new IndicatorsOp().flowIndicator(SECOND_TICKER, eth);
    indicatorOp.flowIndicator(TICKER, btc);
    const ethAfterBtc = indicatorOp.flowIndicator(SECOND_TICKER, eth);

    expect(ethAfterBtc).toEqual(ethAlone);
    expect(ethAfterBtc.ticker).toBe(SECOND_TICKER);
  });
});
