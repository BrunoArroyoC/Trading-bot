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

export type Candle = z.infer<typeof CandleSchema>;
