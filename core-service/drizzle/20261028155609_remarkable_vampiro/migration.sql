CREATE TYPE "exit_reason" AS ENUM('stop', 'signal', 'kill_switch');--> statement-breakpoint
CREATE TYPE "order_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "order_type" AS ENUM('market', 'limit', 'stop', 'stop_limit', 'trailing_stop');--> statement-breakpoint
CREATE TABLE "candles" (
	"ticker" text,
	"timeframe" text,
	"open_time" timestamp with time zone,
	"open" numeric NOT NULL,
	"high" numeric NOT NULL,
	"low" numeric NOT NULL,
	"close" numeric NOT NULL,
	"volume" numeric NOT NULL,
	CONSTRAINT "candles_pkey" PRIMARY KEY("ticker","timeframe","open_time")
);
--> statement-breakpoint
CREATE TABLE "equity_history" (
	"time" timestamp with time zone PRIMARY KEY,
	"equity" numeric NOT NULL,
	"cash" numeric NOT NULL,
	"buying_power" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"snapshot_id" uuid,
	"client_order_id" text NOT NULL UNIQUE,
	"alpaca_order_id" text UNIQUE,
	"ticker" text NOT NULL,
	"side" "order_side" NOT NULL,
	"type" "order_type" NOT NULL,
	"qty" numeric NOT NULL,
	"status" text NOT NULL,
	"filled_qty" numeric DEFAULT '0' NOT NULL,
	"filled_avg_price" numeric,
	"submitted_at" timestamp with time zone,
	"filled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "risk_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"time" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot_id" uuid,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"ticker" text NOT NULL,
	"candle_close_time" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL,
	"degraded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"ticker" text NOT NULL,
	"entry_order_id" uuid NOT NULL,
	"exit_order_id" uuid,
	"qty" numeric NOT NULL,
	"entry_price" numeric NOT NULL,
	"exit_price" numeric,
	"pnl" numeric,
	"pnl_pct" numeric,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"exit_reason" "exit_reason"
);
--> statement-breakpoint
CREATE INDEX "orders_ticker_idx" ON "orders" ("ticker");--> statement-breakpoint
CREATE INDEX "risk_events_time_idx" ON "risk_events" ("time");--> statement-breakpoint
CREATE INDEX "snapshots_ticker_close_idx" ON "snapshots" ("ticker","candle_close_time");--> statement-breakpoint
CREATE INDEX "trades_ticker_opened_idx" ON "trades" ("ticker","opened_at");--> statement-breakpoint
CREATE INDEX "trades_open_idx" ON "trades" ("ticker") WHERE "closed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_snapshot_id_snapshots_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id");--> statement-breakpoint
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_snapshot_id_snapshots_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id");--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_entry_order_id_orders_id_fkey" FOREIGN KEY ("entry_order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_exit_order_id_orders_id_fkey" FOREIGN KEY ("exit_order_id") REFERENCES "orders"("id");