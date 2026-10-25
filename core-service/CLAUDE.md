# core-service

https://docs.alpaca.markets/us/docs/getting-started
https://alpacahq.github.io/alpaca-trade-api-js/

Part of **Jev**, a 24/7 automated paper-trading platform (see `Jev Trading Platform — Mini SRS(1).md` and `Roadmap(1).md`).
core-service is the only service that talks to the broker: it streams Alpaca market data, detects 1H candle closes,
computes indicators, builds the `MarketSnapshot`, validates decisions against the risk rules and places orders.

## Source of truth

- **SRS** (`Jev Trading Platform — Mini SRS(1).md`): requirements (FR-01…FR-15 for core, NFR-01…NFR-16), architecture, tech stack.
- **Roadmap** (`Roadmap(1).md`): phased tasks, each with a *Done when* check. Work on the current phase only; a phase's gate must pass before the next starts.
- When a task maps to a roadmap item or requirement, reference its ID (e.g. "task 1.2", "FR-10").
- If code and these documents disagree, point it out instead of silently picking one.

## Runtime: Bun

**Bun** is the runtime and package manager (`bun install`, `bun add`, `bun run <script>`, `bunx`); don't use node, npm, pnpm or `tsx`.
The rest of the SRS stack still applies (Express 5, Vitest, Zod, Drizzle, …). Don't replace a library from the SRS with
a Bun-native one (e.g. `Bun.serve` instead of Express, `bun:test` instead of Vitest) unless asked.

## Commands

```sh
bun run dev          # bun --watch index.ts, piped through pino-pretty (dev only; see below)
bun run start
bun run typecheck    # tsc --noEmit (bun check also works)
bun run lint         # eslint .
bun run test         # Vitest in watch mode
bun run test --run   # Vitest once (CI)
bunx drizzle-kit generate   # create a migration from src/db/schema.ts
bunx drizzle-kit migrate    # apply migrations
```

- Tests use **Vitest**, not `bun test`: import from `"vitest"`, never from `"bun:test"`.
- Bun loads `.env` automatically; `.env` must stay in `.gitignore`.
- Readable logs in development come only from the `| pino-pretty ...` pipe in the `dev` script; `src/logger.ts` always writes JSON. To remove: delete that pipe from `dev` and run `bun remove pino-pretty`.

## Stack (from SRS §6)

- TypeScript strict, ES modules, Express 5 (`helmet`, `cors`).
- **Zod v4** for env vars (`src/env.ts`), request bodies/queries, queue messages and external responses. Derive types with `z.infer`.
- **Drizzle ORM** + `drizzle-kit` with the Bun SQL driver (`drizzle-orm/bun-sql`); schema in `src/db/schema.ts`, migrations in `drizzle/`.
- `@alpacahq/alpaca-trade-api` **v5** (the version Alpaca recommends; don't downgrade), paper environment, for market data WebSocket, REST history and orders.
- `trading-signals` for indicators: RSI(14), MACD(12,26,9), EMA 20/50/200, Bollinger(20,2), ATR(14), volume average.
- `amqplib` (RabbitMQ), `ioredis` (Redis), `cockatiel` (timeout/retry/circuit breaker), native `fetch`, `croner`, `pino` + `pino-http`.
- Testing: Vitest, Supertest, Testcontainers, MSW (mock Alpaca and Kronos).

## Project layout

```
index.ts                         entry point (Express app, pino-http request logs)
src/logger.ts                    shared pino logger; use it instead of console.log
src/db/schema.ts                 Drizzle tables
src/layers/alpaca/               Alpaca client and streams
src/layers/alpaca/model/         Zod schemas for Alpaca data (e.g. candleZod.ts)
drizzle/                         generated migrations
.test/                           all tests, as *.test.ts (e.g. .test/validationsModel/ for Zod schema tests)
eslint.config.ts                 ESLint flat config (typescript-eslint)
```

Tests go in `.test/`, not next to the code. `.test/` is listed in `tsconfig.json`'s `include` because TypeScript skips dot-folders by default.

**TypeScript versions:** `tsc` is TypeScript 7 (the `@typescript/native` alias). The `typescript` package is aliased to
`@typescript/typescript6` (with an `overrides` entry) because typescript-eslint needs the TS 6 API. Don't "fix" these aliases.

## Rules that must hold

- **The LLM proposes, deterministic code decides.** core validates every decision; on any doubt or failure the result is HOLD / no order (NFR-02).
- **Idempotency:** `snapshotId` is the idempotency key and the Alpaca `client_order_id`; a redelivered message or restart never places a duplicate order (NFR-04).
- **Traceability:** every order links back to its snapshot and decision (NFR-09).
- **Paper trading only:** the Alpaca client always uses `paper: true`. Long-only, no leverage, no shorting.
- **Tickers, risk limits and schedules are configuration**, not code (NFR-12). Message contracts carry a `schemaVersion`.
- **Money and prices:** Postgres `numeric` columns use Drizzle's default string mode to avoid float precision loss. Zod schemas that feed these columns validate numbers and output strings (`.transform(String)`).
- **Positions are open trades:** there is no `positions` table; open positions are `trades` rows with `closed_at IS NULL`.
- External calls (Alpaca, Kronos) use timeouts, retries with backoff and circuit breakers; the WebSocket reconnects on its own (NFR-05).
- Secrets never go in Git, logs or images (NFR-07).

## Testing

Unit tests with Vitest for pure logic (Zod schemas, mappers, candle aggregation, indicators, risk rules); integration tests with
Testcontainers; contract tests that parse the sample messages in `contracts/` with core's Zod schemas. Target ≥ 70% coverage in core (NFR-11).
