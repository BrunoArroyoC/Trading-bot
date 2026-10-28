import {type Bar } from "@alpacahq/alpaca-trade-api";
import * as z from "zod";

// Validated as numbers, then turned into strings to match the `numeric` columns in db/schema.ts.
const price = (field: string) =>
  z.number(`${field} must be a number`).positive(`${field} must be greater than 0`).transform(String);

export const CandleSchema = z
  .object({
    ticker: z.string("ticker must be a string").min(1, "ticker is required"),
    timeframe: z.string("timeframe must be a string").min(1, "timeframe is required"),
    openTime: z.date("openTime must be a date"),
    open: price("open"),
    high: price("high"),
    low: price("low"),
    close: price("close"),
    volume: z.number("volume must be a number").nonnegative("volume can not be negative").transform(String),
  })
  .refine((c) => Number(c.high) >= Number(c.low), {
    message: "high must be greater than or equal to low",
    path: ["high"],
  });


//Transform to Bar to Candle
export function mapperCandle(bar: Bar, ticker: string, timeframe = "1Hour") {
  const candle = CandleSchema.parse({
    ticker,
    timeframe,
    openTime: bar.timestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  });
  return candle;
}

//Function to check each bar if its a bad bar do not pick it and pass the next only if it is in the websocket secction in the start do not start if we do not have all the good bars
export function checkBar(bar: Bar, ticker: string, timeframe = "1Hour") {
  const candle = CandleSchema.safeParse({
    ticker,
    timeframe,
    openTime: bar.timestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  });
  if (!candle.success) {
    return { ok: false, error: "Bad candle" };
  }

  return {ok: true, candle}
}





export type Candle = z.infer<typeof CandleSchema>;
