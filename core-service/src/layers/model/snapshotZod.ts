import * as z from "zod";

// Message contracts (task 2.3). Samples of each message live in ../contracts/ at the repo root,
// shared with the other services; .test/contracts/ parses every sample with these schemas.
const STALE_AFTER_MS = 2 * 60 * 60 * 1000
const SCHEMA_VERSION = 1;
const schemaVersion = z.literal(SCHEMA_VERSION);

// Any real number (can be negative, e.g. MACD). Zod v4 already rejects NaN and Infinity.
const value = (field: string) => z.number(`${field} must be a number`);
const positive = (field: string) => value(field).positive(`${field} must be greater than 0`);
const nonNegative = (field: string) => value(field).nonnegative(`${field} can not be negative`);
const isoTime = (field: string) => z.iso.datetime({ message: `${field} must be an ISO date (UTC)` });

// The closed candle inside the snapshot. Different from the DB CandleSchema: numbers, and no
// ticker/timeframe because the snapshot already carries them.
export const snapshotCandleSchema = z.object({
  open: positive("open"),
  high: positive("high"),
  low: positive("low"),
  close: positive("close"),
  volume: nonNegative("volume"),
});

export type SnapshotCandle = z.infer<typeof snapshotCandleSchema>;

// Same keys flowIndicator returns. Nothing is nullable: if an indicator isn't ready yet,
// parsing fails and no snapshot is built, so the result is HOLD (NFR-02).
export const indicatorSchema = z.object({
  rsi: value("rsi").min(0, "rsi must be between 0 and 100").max(100, "rsi must be between 0 and 100"),
  macd: z.object({
    histogram: value("macd.histogram"),
    macd: value("macd.macd"),
    signal: value("macd.signal"),
  }),
  atr: nonNegative("atr"),
  ema1: positive("ema1"), // EMA 20
  ema2: positive("ema2"), // EMA 50
  ema3: positive("ema3"), // EMA 200
  sma: nonNegative("sma"), // volume average (20)
  bollinger: z
    .object({
      lower: value("bollinger.lower"),
      middle: positive("bollinger.middle"),
      upper: value("bollinger.upper"),
    })
    .refine((b) => b.lower <= b.middle && b.middle <= b.upper, {
      message: "bollinger must be lower <= middle <= upper",
    }),
});

export type Indicator = z.infer<typeof indicatorSchema>;

// What kronos-service answers (FR-05). `degraded` isn't here: Kronos can't report that it is down,
// core decides it when the call fails.
export const KronosForecastSchema = z.object({
  schemaVersion,
  horizonHours: z.number().int().positive("horizonHours must be greater than 0"),
  predictedClose: positive("predictedClose"),
  volatility: nonNegative("volatility"),
});

export type KronosForeceast = z.infer<typeof KronosForecastSchema>;

// What Jev's sentiment job stores in Redis (FR-35). `stale` isn't here: core decides it by
// comparing generatedAt with now (FR-06).
export const sentimentSchema = z.object({
  schemaVersion,
  score: value("score").min(-1, "score must be between -1 and 1").max(1, "score must be between -1 and 1"),
  confidence: value("confidence").min(0, "confidence must be between 0 and 1").max(1, "confidence must be between 0 and 1"),
  keyDrivers: z.array(z.string()),
  generatedAt: isoTime("generatedAt"),
});

export type Sentiment = z.infer<typeof sentimentSchema>;

// core -> Jev on analysis.requests, and the `data` jsonb column of the snapshots table (FR-07, task 2.5).
// The forecast and the sentiment go in without their own schemaVersion: the snapshot's version covers them.
export const MarketSnapshotSchema = z.object({
  //It is to send to jev with an id from the snapshot table and return the decision wiht that id to indentify what snapshot we are looking for.
  snapshotId: z.uuid("snapshotId must be a uuid"),
  schemaVersion,
  ticker: z.string("ticker must be a string").min(1, "ticker is required"),
  candleCloseTime: isoTime("candleCloseTime"),
  candle: snapshotCandleSchema,
  indicators: indicatorSchema,
  // null when Kronos failed or timed out; then degraded is true (FR-05, task 2.4).
  forecast: KronosForecastSchema.omit({ schemaVersion: true }).nullable(),
  // null when Redis has no sentiment for the ticker; stale when it is older than 2 hours (FR-06).
  sentiment: sentimentSchema.omit({ schemaVersion: true }).extend({ stale: z.boolean() }).nullable(),
  degraded: z.boolean(),
});

export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;

// Jev -> core on the decisions queue (FR-32, FR-34). Linked to its snapshot by snapshotId (NFR-09).
export const decisionSchema = z.object({
  schemaVersion,
  snapshotId: z.uuid("snapshotId must be a uuid"),
  ticker: z.string("ticker must be a string").min(1, "ticker is required"),
  action: z.enum(["BUY", "SELL", "HOLD"], "action must be BUY, SELL or HOLD"),
  confidence: value("confidence").min(0, "confidence must be between 0 and 1").max(1, "confidence must be between 0 and 1"),
  reasoning: z.string("reasoning must be a string").min(1, "reasoning is required"),
  validUntil: isoTime("validUntil"),
});

export type Decision = z.infer<typeof decisionSchema>;

export function buildSnapShot(
  ticker: string,
  candleCloseTime: Date,
  candle: SnapshotCandle,
  indicator: Indicator,
  kronos?: KronosForeceast,
  sentiment?: Sentiment,
): MarketSnapshot {
  const marketSnap: MarketSnapshot = {
    snapshotId: crypto.randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    ticker,
    candleCloseTime: candleCloseTime.toISOString(),
    candle,
    indicators: indicator,
    forecast: kronos
      ? { horizonHours: kronos.horizonHours, predictedClose: kronos.predictedClose, volatility: kronos.volatility }
      : null,
    sentiment: sentiment
      ? {
          score: sentiment.score,
          confidence: sentiment.confidence,
          keyDrivers: sentiment.keyDrivers,
          generatedAt: sentiment.generatedAt,
          // Older than 2 hours: Jev is told the sentiment may be out of date.
          stale: Date.now() - new Date(sentiment.generatedAt).getTime() > STALE_AFTER_MS,
        }
      : null,
    degraded: !kronos,
  };
  // One parse checks everything at once, including candle and indicators
  return MarketSnapshotSchema.parse(marketSnap);
}
