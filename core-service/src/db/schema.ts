import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Numeric columns use the default string mode to avoid float precision loss on prices/money.
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const orderSide = pgEnum('order_side', ['buy', 'sell']);
export const orderType = pgEnum('order_type', ['market', 'limit', 'stop', 'stop_limit', 'trailing_stop']);
export const exitReason = pgEnum('exit_reason', ['stop', 'signal', 'kill_switch']);

export const candles = pgTable(
  'candles',
  {
    ticker: text('ticker').notNull(),
    timeframe: text('timeframe').notNull(),
    openTime: ts('open_time').notNull(),
    open: numeric('open').notNull(),
    high: numeric('high').notNull(),
    low: numeric('low').notNull(),
    close: numeric('close').notNull(),
    volume: numeric('volume').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ticker, t.timeframe, t.openTime] })],
);

export const snapshots = pgTable(
  'snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticker: text('ticker').notNull(),
    candleCloseTime: ts('candle_close_time').notNull(),
    data: jsonb('data').notNull(),
    degraded: boolean('degraded').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('snapshots_ticker_close_idx').on(t.ticker, t.candleCloseTime)],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    snapshotId: uuid('snapshot_id').references(() => snapshots.id),
    clientOrderId: text('client_order_id').notNull().unique(),
    alpacaOrderId: text('alpaca_order_id').unique(),
    ticker: text('ticker').notNull(),
    side: orderSide('side').notNull(),
    type: orderType('type').notNull(),
    qty: numeric('qty').notNull(),
    // Alpaca has many order statuses (new, partially_filled, filled, canceled, ...), kept as text.
    status: text('status').notNull(),
    filledQty: numeric('filled_qty').notNull().default('0'),
    filledAvgPrice: numeric('filled_avg_price'),
    submittedAt: ts('submitted_at'),
    filledAt: ts('filled_at'),
  },
  (t) => [index('orders_ticker_idx').on(t.ticker)],
);

export const trades = pgTable(
  'trades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticker: text('ticker').notNull(),
    entryOrderId: uuid('entry_order_id').notNull().references(() => orders.id),
    exitOrderId: uuid('exit_order_id').references(() => orders.id),
    qty: numeric('qty').notNull(),
    entryPrice: numeric('entry_price').notNull(),
    exitPrice: numeric('exit_price'),
    pnl: numeric('pnl'),
    pnlPct: numeric('pnl_pct'),
    openedAt: ts('opened_at').notNull(),
    closedAt: ts('closed_at'),
    exitReason: exitReason('exit_reason'),
  },
  // Exit fields stay null until the position closes; closed_at IS NULL = open position.
  (t) => [
    index('trades_ticker_opened_idx').on(t.ticker, t.openedAt),
    index('trades_open_idx').on(t.ticker).where(sql`${t.closedAt} IS NULL`),
  ],
);

// Hourly samples for the equity curve.
export const equityHistory = pgTable('equity_history', {
  time: ts('time').primaryKey(),
  equity: numeric('equity').notNull(),
  cash: numeric('cash').notNull(),
  buyingPower: numeric('buying_power').notNull(),
});

// Why a decision was rejected.
export const riskEvents = pgTable(
  'risk_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    time: ts('time').notNull().defaultNow(),
    snapshotId: uuid('snapshot_id').references(() => snapshots.id),
    reason: text('reason').notNull(),
  },
  (t) => [index('risk_events_time_idx').on(t.time)],
);

// Kill switch state, risk parameters, enabled tickers.
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});
