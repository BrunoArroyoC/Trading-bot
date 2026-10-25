# Jev Trading Platform — Mini SRS

Oct 22, 2026 · @Bruno

## 1. Project description

Jev is a 24/7 automated paper-trading platform built as TypeScript microservices on Bun and Express: deterministic code reads the market, computes indicators, manages risk and places orders, while AI models only advise. It runs in a home lab on Kubernetes and trades through the Alpaca API on 1-hour candles.

### 1.1 Purpose

- **Portfolio:** demonstrate production-style backend engineering in TypeScript: microservices, messaging, WebSockets, authentication, AI integration, observability, CI/CD and Kubernetes, plus one Python service for the forecasting model.
- **Trading:** run a careful strategy that does not lose paper money and aims for a small, steady return (target 2–2.5% per year), measured against a benchmark.

### 1.2 How it works

The **core** service streams live market data from Alpaca over WebSocket. When a 1H candle closes, it computes the technical indicators, asks the **Kronos** service for a candle and volatility forecast, and reads the latest market sentiment from the cache. It packs all of this into a market snapshot and publishes it to a queue.

**Jev** consumes the snapshot, looks up similar past trades in its memory, and asks an LLM for a structured decision: BUY, SELL or HOLD, with a confidence and its reasoning. Jev publishes the decision back to the core.

The core validates the decision against hard risk rules and only then sends the order to Alpaca over REST. Every trade, with its full context and result, is stored and exported as an Obsidian note, so Jev can consult past outcomes on later decisions.

A background job refreshes market sentiment from news every 30–60 minutes. An auth service and a gateway protect the React dashboard, where the admin can monitor performance and stop trading.

### 1.3 Design principles

- **The LLM proposes, deterministic code decides.** Jev never talks to the broker; the core can veto any decision.
- **Paper trading first.** Real money is out of scope until the success metrics hold for at least 3 months.
- **Every decision is traceable.** Each order links back to the snapshot and reasoning that produced it.
- **Tickers are data, not infrastructure.** One deployment per service handles every ticker.

### 1.4 Scope

**In scope (MVP):** 1–2 tickers on Alpaca paper trading, long-only spot positions, 1H candles, indicator calculation, Kronos forecasts, scheduled sentiment, Jev decisions with trade memory, risk layer with kill switch, trade journal (Postgres + Obsidian), login, dashboard, deployment on the home lab.

**Out of scope:** real-money trading, leverage, short selling, options, high-frequency or sub-hour strategies, multiple users with their own accounts, a public API.

### 1.5 Success metrics

| Metric | Target | Measured over |
| --- | --- | --- |
| Net return after costs | ≥ 0, aiming for 2–2.5% annualised | 3 months of paper trading |
| Max drawdown | Lower than buy-and-hold of the same asset | Same period |
| Sharpe ratio | Higher than buy-and-hold | Same period |
| Closed trades | ≥ 100 before judging the strategy | Paper trading + backtest |
| Traceability | 100% of orders linked to a snapshot and decision | Continuous |
| Availability | ≥ 99% of candle closes processed | Monthly |

## 2. Architecture

Five deployables run on a single k3s cluster: four TypeScript services (Bun + Express) plus one Python service, connected by REST for request/response calls and RabbitMQ for the decision loop. Only the core talks to the broker. Kronos stays in Python because the model runs on PyTorch.

&#91;embedded content: System architecture · 5 services, 1 broker, shared data layer\]

The core sends a snapshot to Jev through RabbitMQ and receives the decision on a separate queue; Kronos is a synchronous REST call because the core needs its forecast before building the snapshot.

| Service | Language | Responsibility | Communicates with |
| --- | --- | --- | --- |
| core-service | TypeScript / Express | Market data, indicators, snapshot, risk, order execution | Alpaca (WebSocket + REST), Kronos (REST), RabbitMQ, Postgres, Redis |
| jev-service | TypeScript / Express + AI SDK | Trading decision, trade memory, sentiment job, Obsidian export | RabbitMQ, LLM provider, Postgres + pgvector, Redis |
| kronos-service | Python / FastAPI | Candle and volatility forecast per ticker | Called by core over REST |
| auth-service | TypeScript / Express + Better Auth | Sign-in, sessions, users and roles, JWT issuing (JWKS) | Dashboard, gateway, Postgres |
| api-gateway | TypeScript / Express | Single entry point, JWT validation, routing | Dashboard, all services |

**Infrastructure:** RabbitMQ, PostgreSQL with pgvector, Redis, Prometheus + Grafana, all on k3s in the home lab. Tickers are configuration: one deployment per service serves every ticker, and replicas scale with queue depth if needed.

## 3. Functional requirements

The MVP needs every **Must** requirement; **Should** items come in the next phase and **Could** items are optional extras for the portfolio.

### 3.1 core-service

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-01 | Connect to the Alpaca market data WebSocket for every configured ticker, reconnect with exponential backoff and resubscribe after a drop. | Must |
| FR-02 | On startup, load recent history (at least 512 1H bars per ticker) through the Alpaca REST API so indicators and Kronos have enough context. | Must |
| FR-03 | Detect each 1H candle close per ticker and start one analysis cycle for it. | Must |
| FR-04 | Compute indicators with `trading-signals`: RSI(14), MACD(12,26,9), EMA 20/50/200, Bollinger Bands(20,2), ATR(14) and volume average. | Must |
| FR-05 | Request a forecast from kronos-service with a timeout; if it fails, continue and mark the snapshot as degraded. | Must |
| FR-06 | Read the latest sentiment from Redis and mark it stale when it is older than 2 hours. | Must |
| FR-07 | Build a `MarketSnapshot`, store it in Postgres and publish it to the `analysis.requests` queue. | Must |
| FR-08 | Consume decisions and discard any that are expired (`validUntil`) or already processed (`snapshotId`). | Must |
| FR-09 | Validate every decision against the risk rules: risk per trade, maximum position size, maximum open positions, daily loss limit, long-only. | Must |
| FR-10 | Place approved orders through the Alpaca REST API with `client_order_id` = `snapshotId`, each entry with an ATR-based stop-loss. | Must |
| FR-11 | Follow fills through the Alpaca trade-updates stream, keep positions in sync and compute P&L when a position closes. | Must |
| FR-12 | Publish a `trade.closed` event with the trade, its snapshot and its result. | Must |
| FR-13 | Provide a kill switch that blocks new orders, triggered manually by the admin or automatically by the daily loss limit or repeated errors. | Must |
| FR-14 | Expose a REST API for the dashboard: positions, trades, equity curve, metrics, configuration. | Must |
| FR-15 | Run a backtest of the indicator strategy on stored historical bars and report the same metrics as live trading. | Should |

### 3.2 kronos-service

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-20 | Expose `POST /forecast` that takes a ticker and up to 512 OHLCV candles and returns the predicted candles for the next N hours plus a volatility estimate. | Must |
| FR-21 | Load the model once at startup and expose health and readiness endpoints. | Must |
| FR-22 | Run on CPU with the small model and answer within the core's timeout. | Must |

### 3.3 jev-service

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-30 | Consume snapshots from `analysis.requests` and validate each one with the `MarketSnapshot` Zod schema; invalid messages go to the dead-letter queue. | Must |
| FR-31 | Retrieve the most similar past trades (pgvector similarity on the snapshot) with their outcomes. | Must |
| FR-32 | Build the prompt from the snapshot, the similar trades and the strategy rules, and call the LLM through the AI SDK with structured output validated by the `Decision` Zod schema. | Must |
| FR-33 | Return HOLD when the LLM times out, fails or returns an invalid decision. | Must |
| FR-34 | Publish the decision with a `validUntil` and store the decision and its reasoning in Postgres. | Must |
| FR-35 | Every 30–60 minutes, collect news for each ticker (Alpaca news + web search), have the LLM produce a sentiment score from −1 to 1 with confidence and key drivers, and store it in Redis and Postgres. | Must |
| FR-36 | On `trade.closed`, write the trade to the journal: embedding in pgvector and an Obsidian Markdown note, for wins and losses alike. | Must |
| FR-37 | Never change strategy rules on its own; trade memory is context for decisions only. | Must |
| FR-38 | Expose trade-history queries as MCP tools so an assistant can analyse the journal. | Could |

### 3.4 auth-service and api-gateway

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-40 | Sign in with email and password through Better Auth (database sessions), and issue a short-lived JWT for calls through the gateway. | Must |
| FR-41 | Support two roles stored on the Better Auth user: ADMIN (configuration, kill switch) and VIEWER (read-only). | Must |
| FR-42 | Route all dashboard API traffic through the gateway, which verifies the JWT against the auth-service JWKS and checks the role for each route. | Must |

### 3.5 Dashboard

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-50 | Show the equity curve against buy-and-hold, open positions, recent trades with Jev's reasoning, latest sentiment and Kronos forecast. | Must |
| FR-51 | Show system health: service status, last candle processed, queue depth, kill switch state. | Must |
| FR-52 | Let the admin activate the kill switch, enable or disable tickers and edit risk parameters. | Must |
| FR-53 | Offer a public read-only demo view for recruiters. | Should |

## 4. Non-functional requirements

The system must keep running unattended in the home lab, fail safe (no order when in doubt) and make every decision explainable.

| ID | Category | Requirement |
| --- | --- | --- |
| NFR-01 | Availability | Process ≥ 99% of candle closes per month; every service restarts automatically through Kubernetes liveness and readiness probes. |
| NFR-02 | Fail-safe | Any failure in Kronos, Jev, the LLM or sentiment results in HOLD, never in an unvalidated order. |
| NFR-03 | Latency | A full cycle (candle close → order sent) completes in under 2 minutes; decisions older than 10 minutes are discarded. |
| NFR-04 | Idempotency | A redelivered message or a restart never places a duplicate order (`snapshotId` as idempotency key and `client_order_id`). |
| NFR-05 | Resilience | Calls to Alpaca, Kronos and the LLM use timeouts, retries with backoff and circuit breakers; the WebSocket reconnects on its own. |
| NFR-06 | Consistency | Messages for the same ticker are processed in order; positions are reconciled with Alpaca on startup and every hour. |
| NFR-07 | Security | API keys and passwords live in Kubernetes Secrets (or Sealed Secrets), never in Git or images; passwords hashed by Better Auth; JWT on every external route; environment variables validated with Zod at startup. |
| NFR-08 | Exposure | Only the gateway is reachable from outside the cluster, through HTTPS (Cloudflare Tunnel or reverse proxy); databases and the broker stay internal. |
| NFR-09 | Traceability | Every order links to its snapshot, decision, reasoning and result; a correlation id travels through logs and traces. |
| NFR-10 | Observability | Metrics in Prometheus with Grafana dashboards, structured JSON logs, distributed tracing with OpenTelemetry; alerts for a missed candle, kill switch, errors. |
| NFR-11 | Testability | Unit tests with Vitest for indicators and risk rules, integration tests with Testcontainers (Postgres, Redis, RabbitMQ), contract tests validating the sample messages in `contracts/` against each service's Zod schemas; ≥ 70% coverage in core. |
| NFR-12 | Maintainability | Tickers, risk limits, schedules and model names are configuration, changed without code; message contracts carry a `schemaVersion`. |
| NFR-13 | Deployability | Each service ships as a container image built by the CI/CD pipeline and deployed to k3s with Helm or Kustomize. |
| NFR-14 | Resource budget | The whole stack fits the home lab: Kronos small model on CPU, total memory target under 8 GB (to confirm against the hardware). |
| NFR-15 | Cost | LLM spend has a monthly cap with alerts; the sentiment job and Jev calls are limited by schedule and candle frequency. |
| NFR-16 | Data retention | Trades, snapshots and decisions kept indefinitely; raw ticks are not stored; daily Postgres backups. |

## 5. Example workflow: one 1H candle

A BTC/USD candle closes at 14:00 UTC and, about 30 seconds later, a paper buy order is on Alpaca with its stop-loss attached. Times below are illustrative targets.

1. **13:30 · sentiment job (jev).** The scheduled job collects BTC news, the LLM scores it +0.35 with confidence 0.6, and the result goes to Redis with its timestamp.
2. **14:00:00 · candle close (core).** The 1H candle for 13:00–14:00 is complete; core appends it to the ticker's candle buffer.
3. **14:00:01 · indicators (core).** `trading-signals` computes RSI 41, MACD crossing up, price above EMA 200, ATR 620.
4. **14:00:02 · forecast (core → kronos).** Core sends the last 512 candles; Kronos returns the next 6 candles and expected volatility.
5. **14:00:05 · snapshot (core).** Core reads sentiment from Redis, builds the `MarketSnapshot`, stores it and publishes it to `analysis.requests`.
6. **14:00:06 · memory (jev).** Jev consumes the snapshot and retrieves the 5 most similar past setups and how they ended.
7. **14:00:20 · decision (jev → LLM).** The AI SDK returns a `Decision` validated by Zod: BUY, confidence 0.68, with its reasoning. Jev stores it and publishes it to `decisions` with `validUntil` 14:10.
8. **14:00:21 · risk check (core).** Not expired, not a duplicate, no open BTC position, daily loss limit not hit. Size = 0.5% of equity at risk with the stop 1.5 × ATR below entry.
9. **14:00:22 · execution (core → Alpaca).** Core sends a bracket order with `client_order_id` = `snapshotId` and the stop-loss attached.
10. **Later · close (core → jev).** The stop or a SELL decision closes the position. Core computes P&L and publishes `trade.closed`; Jev embeds the trade in pgvector and writes the Obsidian note.

**Alternative paths:**

- Jev returns HOLD → core logs it; no order.
- Risk check fails (position already open, size too large, loss limit hit) → decision rejected and logged with the reason.
- Kronos down → snapshot marked degraded; Jev's prompt states the forecast is missing.
- LLM timeout or invalid output → Jev publishes HOLD.
- Decision arrives after `validUntil` → core discards it.
- Kill switch active → core skips the cycle after storing the snapshot.

The two messages for this example:

```json
{
  "snapshotId": "7f3c…",
  "schemaVersion": 1,
  "ticker": "BTC/USD",
  "candleCloseTime": "2026-10-22T14:00:00Z",
  "candle": { "open": 67210, "high": 67540, "low": 67020, "close": 67480, "volume": 182.4 },
  "indicators": { "rsi14": 41.2, "macdHist": 12.5, "ema20": 67150, "ema50": 66890, "ema200": 65400, "atr14": 620 },
  "forecast": { "horizonHours": 6, "predictedClose": 67910, "volatility": 0.011, "degraded": false },
  "sentiment": { "score": 0.35, "confidence": 0.6, "generatedAt": "2026-10-22T13:30:00Z", "stale": false }
}
```

```json
{
  "snapshotId": "7f3c…",
  "ticker": "BTC/USD",
  "action": "BUY",
  "confidence": 0.68,
  "reasoning": "Uptrend above EMA 200, MACD turning up from a neutral RSI; forecast and sentiment agree; similar past setups closed positive 3 of 5 times.",
  "validUntil": "2026-10-22T14:10:00Z"
}
```

## 6. Tech stack and libraries

The baseline is **Bun + TypeScript (strict mode) + Express 5**, with ES modules. Each service is its own Bun project in the shared repo, with its own `package.json`, `tsconfig.json` and Dockerfile; message shapes are Zod schemas declared in each service and checked against the sample JSON in `contracts/`.

### 6.1 Shared by every TypeScript service

| Purpose | Library |
| --- | --- |
| Language and tooling | TypeScript (strict), Bun (runtime, package manager, `bun --watch` for development, `bun build` for builds), `tsc` for type checking |
| HTTP framework | Express 5, `helmet`, `cors` |
| Validation | Zod: environment variables, request bodies, queue messages, LLM output |
| Database | Drizzle ORM + `drizzle-kit` migrations, Bun SQL driver (`drizzle-orm/bun-sql`) |
| Messaging | `amqplib` for RabbitMQ (with your own reconnect wrapper) |
| Cache | `ioredis` |
| Resilience | `cockatiel` (retry, circuit breaker, timeout) |
| HTTP client | Native `fetch` |
| Scheduling | `croner` |
| Logging | `pino` + `pino-http` (JSON logs) |
| Observability | `prom-client` for metrics, OpenTelemetry Node SDK for tracing |
| Testing | Vitest, Supertest, Testcontainers for Node, MSW to mock Alpaca and Kronos |
| Code quality | ESLint + Prettier (or Biome) |

### 6.2 Per service

| Service | Purpose | Library |
| --- | --- | --- |
| core-service | Alpaca market data, news and trading | Official `@alpacahq/alpaca-trade-api` v5 (TypeScript SDK: REST + WebSocket streams) |
| core-service | Indicators | `trading-signals` (TypeScript, zero dependencies, streaming and batch modes) |
| core-service | Backtesting | Own backtest runner over stored candles, reusing the same strategy and indicator code |
| core-service | Order and position state | Drizzle tables in Postgres |
| jev-service | LLM calls, structured output | AI SDK (`ai`) + provider package (`@ai-sdk/anthropic`, `@ai-sdk/openai` or an Ollama provider); `generateText` with `Output.object` and a Zod schema |
| jev-service | Trade memory | AI SDK `embed` + pgvector column in Drizzle with cosine-distance queries |
| jev-service | MCP tools over the journal | `@modelcontextprotocol/sdk` |
| jev-service | Sentiment sources | Alpaca news (same SDK) + a web search API (Tavily or Brave Search) through `fetch` |
| jev-service | Scheduled sentiment job | `croner` |
| jev-service | Obsidian notes | Markdown with YAML front matter (`gray-matter`), written to a persistent volume synced by Git or Syncthing |
| kronos-service | API | Python 3.11, FastAPI, Uvicorn, Pydantic |
| kronos-service | Model | Kronos (`shiyu-coder/Kronos`), `NeoQuasar/Kronos-small` from Hugging Face, PyTorch CPU build, pandas |
| kronos-service | Ops and tests | prometheus-fastapi-instrumentator, pytest |
| auth-service | Sign-in, sessions, roles | Better Auth with `@better-auth/drizzle-adapter`, email and password, admin plugin (roles), JWT plugin (JWKS endpoint) |
| api-gateway | Routing and token checks | Express 5 + `http-proxy-middleware`, `jose` to verify JWTs against the JWKS, `express-rate-limit` |

### 6.3 Frontend

Vite + React + TypeScript, shadcn/ui with Tailwind CSS, TanStack Query for API data, React Router, Better Auth React client for sign-in, React Hook Form + Zod for forms, TradingView Lightweight Charts for candles and Recharts for the equity curve.

### 6.4 Infrastructure and delivery

| Area | Tool |
| --- | --- |
| Orchestration | k3s on the home lab, Helm charts per service |
| Broker | RabbitMQ (consistent-hash exchange plugin for per-ticker ordering) |
| Data | PostgreSQL with the pgvector extension, Redis |
| Monitoring | Prometheus, Grafana, Loki for logs, Alertmanager to Telegram |
| Images | Multi-stage Dockerfiles (`oven/bun` slim; Python for Kronos), GitHub Container Registry |
| CI/CD | Jenkins pipeline: lint, type-check, tests, image push, Helm deploy |
| Secrets and access | Sealed Secrets in Git, Cloudflare Tunnel exposing only the gateway and the dashboard |

## 7. Assumptions and open decisions

These defaults hold until decided otherwise; the trading strategy is the largest open item.

| Decision | Current assumption | Affects |
| --- | --- | --- |
| Market | Crypto (BTC/USD) so the bot trades 24/7; US stocks remain an option | FR-01, FR-02, fees, data feed |
| Tickers for the MVP | 1–2, added through configuration | Scope, testing |
| Strategy rules | Indicator-based entry and exit rules; Jev confirms or vetoes | FR-04, FR-09, FR-15, Jev prompt |
| Risk limits | 0.5% of equity at risk per trade, ATR stop, daily loss limit, max open positions to define | FR-09, FR-13 |
| LLM provider | API model for Jev with a monthly cost cap; Ollama as a fallback | FR-32, FR-35, NFR-15 |
| Sentiment sources | Alpaca news + one web search API | FR-35 |
| Home lab hardware | Enough for k3s + Kronos small on CPU; to confirm RAM and CPU | NFR-14 |
| Evaluation period | 3 months of paper trading and ≥ 100 closed trades before judging | Success metrics |

### Sources

- [Alpaca Node.js SDK 4 (TypeScript rewrite) announcement](https://alpaca.markets/blog/alpaca-rebuilds-its-node-js-sdk-with-broader-api-coverage-and-launches-its-first-supported-java-sdk/)
- [trading-signals on GitHub](https://github.com/bennycode/trading-signals)
- [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)
- [AI SDK documentation](https://ai-sdk.dev)
- [Kronos paper (AAAI 2026)](https://ojs.aaai.org/index.php/AAAI/article/view/39730) and [model card](https://huggingface.co/NeoQuasar/Kronos-base)

Development plan with checkable tasks: Roadmap
