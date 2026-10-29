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


export function convertToHourCandle(bars: Bar[], ticker: string) {
  // `as const` makes `ok` the literal false/true, so `if (result.ok)` tells TypeScript `candle` exists.
  if (!bars.length) {
    return { ok: false as const, error: "Error, no bars" };
  }
  // noUncheckedIndexedAccess types bars[i] as `Bar | undefined`; the length check above guarantees both exist.
  const firstBar = bars[0]!;
  const lastBar = bars[bars.length - 1]!;
  if (bars.length < 59) {
    return { ok: false as const, error: "Error, no bars" };
  }
  const max = Math.max(...bars.map((b) => b.high));
  const min = Math.min(...bars.map((b) => b.low));
  const volumeBar = bars.reduce((accum, act) => accum + act.volume, 0);


  const openTime = new Date(hourStart(firstBar.timestamp));

  const auxBar: Bar = {
    timestamp: openTime,
    open: firstBar.open,
    high: max,
    low: min,
    close: lastBar.close,
    volume: Number(volumeBar.toFixed(8)),
  };

  const candle = mapperCandle(auxBar, ticker)
  return { ok: true as const, candle };
}

// Start of the UTC hour a time belongs to, in ms (18:42 → 18:00).
export function hourStart(date: Date): number {
  const start = new Date(date);
  start.setUTCMinutes(0, 0, 0);
  return start.getTime();
}

// The "decoder" between the two queues: a bar from the same hour joins currentHour;
// a bar from a later hour closes currentHour (returned as closedHour) and starts a new one.
// Pure: returns new arrays instead of changing the input.
export function addBarToHour(currentHour: Bar[], bar: Bar) {
  const firstBar = currentHour[0];
  if (!firstBar) {
    return { currentHour: [bar], closedHour: null };
  }

  const barHour = hourStart(bar.timestamp);
  const currentHourStart = hourStart(firstBar.timestamp);

  // A late bar from an hour that is already closed: ignore it (the REST check corrects that hour).
  if (barHour < currentHourStart) {
    return { currentHour, closedHour: null };
  }
  if (barHour > currentHourStart) {
    return { currentHour: [bar], closedHour: currentHour };
  }
  return { currentHour: [...currentHour, bar], closedHour: null };
}





export type Candle = z.infer<typeof CandleSchema>;
