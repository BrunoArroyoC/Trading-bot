DROP INDEX "snapshots_ticker_close_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_ticker_close_idx" ON "snapshots" ("ticker","candle_close_time");