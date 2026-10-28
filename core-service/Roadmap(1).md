# Development roadmap

Twelve phases take the project from an empty repo to a bot trading paper money 24/7. Each task is small enough for one session and has a **Done when** check; tick it only when that check passes.

Each phase ends with a gate: don't start the next phase until every task above it is ticked. Phase 4 already gives you a working bot without AI; the AI services are added on top of it.

## Phase 0 · Foundations

Goal: every TypeScript service starts locally, the local infrastructure runs in Docker, and CI is green.

- [ ] **0.1** Create a Git repo with folders `core-service`, `jev-service`, `kronos-service`, `auth-service`, `api-gateway`, `dashboard`, `contracts`, `infra`, `docs`. *Done when:* pushed to GitHub with a README linking to this SRS.
- [x] **0.2** Install Bun as the runtime and package manager. *Done when:* `bun -v` prints the installed version.
- [ ] **0.3** Create `core-service` as its own Bun project: Express 5, TypeScript in strict mode, a `bun --watch` dev script and a `/health` route. *Done when:* `bun run dev` starts it and `GET /health` returns `{ "status": "ok" }`.
- [ ] **0.4** Create the same skeleton for `jev-service`, `auth-service` and `api-gateway`. *Done when:* all four start on different ports and answer `/health`.
- [x] **0.5** Add the same scripts and tooling to every service: `dev`, `build`, `test`, `lint`, `typecheck`, with ESLint and Prettier. *Done when:* `bun run lint` and `bun run typecheck` pass in each service.
- [ ] **0.6** Validate environment variables with a Zod schema in `src/env.ts` of each service. *Done when:* a missing variable stops the service with a clear error message.
- [x] **0.7** Add `pino` and `pino-http` logging. *Done when:* each request prints one JSON log line.
- [x] **0.8** Set up Vitest with a first test in each service. *Done when:* `bun run test` passes.
- [x] **0.9** Write `docker-compose.yml` with PostgreSQL + pgvector, Redis and RabbitMQ (management plugin). *Done when:* `docker compose up` shows all three healthy and the RabbitMQ UI opens.
- [ ] **0.10** Set up Drizzle in `core-service`: `drizzle.config.ts`, a first table, a generated migration. *Done when:* `drizzle-kit migrate` creates the table in Postgres.
- [ ] **0.11** Create the Alpaca paper account and API keys; keep them in `.env`. *Done when:* the keys load through the Zod env schema and `.env` is in `.gitignore`.
- [ ] **0.12** Create a Jenkins pipeline that runs lint, type-check and tests for each service on every push. *Done when:* a passing build is green and a deliberately broken test turns it red.

**Gate:** all services start locally, Docker infrastructure is healthy, CI is green.

## Phase 1 · Market data in core

Goal: core receives live data from Alpaca and detects every 1H candle close without gaps.
- [x] **1.1** Install `@alpacahq/alpaca-trade-api` v5 and create a client module pointed at the paper environment. *Done when:* core logs the paper account equity at startup.
- [x] **1.2** Define a `Candle` Zod schema and a mapper from the Alpaca bar type. *Done when:* a unit test checks every field (time, OHLC, volume).
- [x] **1.3** Load the last 512 1H bars per ticker through the REST API at startup. *Done when:* a log shows 512 bars and the timestamp of the latest closed one.
- [x] **1.4** Create a `candles` table in Drizzle (unique on ticker + time) and upsert the history. *Done when:* restarting core twice creates no duplicate rows.
- [ ] **1.5** Subscribe to the WebSocket minute-bar stream for the configured tickers. *Done when:* a log line appears for each new minute bar.
- [ ] **1.6** Write a pure function that aggregates minute bars into 1H candles. *Done when:* unit tests cover a normal hour, a missing minute and the hour boundary.
- [ ] **1.7** Emit a typed `candleClosed` event per ticker when an hour closes, and confirm the candle against the REST 1H bar. *Done when:* over 3 hours, exactly one event per ticker per hour is logged and it matches Alpaca's bar.
- [ ] **1.8** Reconnect the WebSocket with exponential backoff and resubscribe. *Done when:* after disconnecting the network for a minute, logs show the reconnect and bars resume.
- [ ] **1.9** Backfill any candles missed while disconnected. *Done when:* after a 2-hour stop, the `candles` table has no gap.
- [ ] **1.10** Add an integration test with Testcontainers for Postgres and MSW mocking the Alpaca REST API. *Done when:* it passes in Jenkins.

**Gate:** core runs 24 hours locally and stores every 1H candle with no gaps or duplicates.

## Phase 2 · Indicators and snapshot

Goal: every candle close produces a stored snapshot with correct indicators.

- [ ] **2.1** Keep a candle buffer per ticker, loaded from history and extended on each candle close, with a maximum length. *Done when:* the buffer grows by one candle per hour and never exceeds the limit.
- [ ] **2.2** Implement an indicator module with `trading-signals` for RSI(14), MACD(12,26,9), EMA 20/50/200, Bollinger(20,2), ATR(14) and volume average. *Done when:* for one chosen candle each value matches TradingView within 0.5%.
- [ ] **2.3** Define the message Zod schemas in core (`Candle`, `Indicators`, `KronosForecast`, `Sentiment`, `MarketSnapshot`, `Decision`, with `schemaVersion`), derive the types with `z.infer`, and save a sample of each message in `contracts/`. *Done when:* a test parses every sample file with its schema.
- [ ] **2.4** Build `buildSnapshot()`, accepting a missing forecast or sentiment and setting the `degraded` and `stale` flags. *Done when:* unit tests cover complete, degraded and stale snapshots.
- [ ] **2.5** Store snapshots in Postgres (Drizzle table with a `jsonb` column + ticker + time). *Done when:* exactly one row appears per ticker per hour.
- [ ] **2.6** Expose `GET /api/snapshots/latest?ticker=` with the query validated by Zod. *Done when:* it returns the latest snapshot, and an unknown ticker returns 400.

**Gate:** for 24 hours, every candle close produces a snapshot with verified indicators.

## Phase 3 · Strategy rules and backtest

Goal: a rule-based strategy that does not lose money on data it was not tuned on, after costs.

- [ ] **3.1** Write the entry, exit and stop-loss rules in plain words in the SRS. *Done when:* each rule is one sentence with exact indicator values.
- [ ] **3.2** Implement the rules as a pure function that takes candles and indicators and returns an entry or exit signal. *Done when:* unit tests on a synthetic series trigger an entry and an exit at the expected candles.
- [ ] **3.3** Download 1–2 years of 1H bars for the MVP tickers. *Done when:* the data is stored and has no gaps.
- [ ] **3.4** Build a backtest runner (`bun run backtest`) that includes fees and slippage. *Done when:* it prints every simulated trade with entry, exit and cost.
- [ ] **3.5** Report the metrics: net return, max drawdown, Sharpe, win rate, number of trades, and buy-and-hold for the same period. *Done when:* the report is saved as a file per run.
- [ ] **3.6** Split the data: tune on the first 70%, test on the last 30% without changes. *Done when:* both reports exist side by side.
- [ ] **3.7** Create a `ruleBasedDecider` that turns a snapshot into a `Decision` using the same rule function. *Done when:* its decisions match the backtest on the same candles.

**Gate:** out-of-sample result ≥ 0 after costs with a drawdown below buy-and-hold. If not, iterate on 3.1–3.6 before moving on.

## Phase 4 · Risk layer and paper execution

Goal: the first working bot. The rule-based strategy trades on Alpaca paper, protected by the risk layer, with no AI yet.

- [ ] **4.1** Define a `RiskConfig` Zod schema: risk per trade, maximum position size, maximum open positions, daily loss limit, ATR stop multiplier. *Done when:* values load from configuration and invalid values stop startup.
- [ ] **4.2** Implement the long-only and one-position-per-ticker rules. *Done when:* unit tests show a BUY rejected when a position is open, and a SELL rejected with no position.
- [ ] **4.3** Implement position sizing from risk per trade and the ATR stop. *Done when:* a unit test with fixed equity, price and ATR gives the expected quantity.
- [ ] **4.4** Implement the daily loss limit and maximum open positions. *Done when:* unit tests show each limit rejecting a decision with a clear reason.
- [ ] **4.5** Reject expired decisions and record processed `snapshotId`s in a Drizzle table. *Done when:* sending the same decision twice places only one order.
- [ ] **4.6** Implement the order module with bracket orders (entry + stop-loss) and `client_order_id` = `snapshotId`. *Done when:* a test order appears in the Alpaca paper dashboard with its stop attached.
- [ ] **4.7** Subscribe to the trade-updates stream and keep the `orders` and `positions` tables in sync. *Done when:* a filled order changes to `filled` in the database within seconds.
- [ ] **4.8** Reconcile positions with Alpaca at startup and every hour. *Done when:* closing a position by hand in the Alpaca UI is reflected in core within an hour.
- [ ] **4.9** Compute P&L when a position closes and emit a `tradeClosed` event (in-process for now). *Done when:* a closed trade has entry, exit, P&L and its snapshot id.
- [ ] **4.10** Add the kill switch: an endpoint plus automatic activation on the daily loss limit or repeated errors. *Done when:* while active, every decision is rejected with reason `KILL_SWITCH`.
- [ ] **4.11** Wire the full loop: candle close → snapshot → `ruleBasedDecider` → risk → order. *Done when:* it runs 48 hours on paper and every order links to a snapshot.

**Gate (milestone):** a working rule-based bot on paper trading. Commit, tag `v0.1` and write a short README section about it.

## Phase 5 · RabbitMQ and Jev decisions

Goal: decisions move through RabbitMQ and Jev decides with an LLM, falling back to HOLD on any failure.

- [ ] **5.1** Write an `amqplib` connection module with automatic reconnect, and declare the exchanges and queues (`analysis.requests`, `decisions`, `trade.closed`) with dead-letter queues. *Done when:* they appear in the RabbitMQ UI after startup, and restarting RabbitMQ reconnects the service.
- [ ] **5.2** Make core publish each snapshot as JSON. *Done when:* a message with the full snapshot is visible in the queue.
- [ ] **5.3** Make Jev consume snapshots and parse them with its own `MarketSnapshot` Zod schema; invalid messages are rejected to the dead-letter queue. *Done when:* a valid message is logged and a malformed one lands in the DLQ.
- [ ] **5.4** Return a stub decision (always HOLD) and have core consume it. *Done when:* core logs the HOLD for each candle, end to end.
- [ ] **5.5** Install the AI SDK (`ai`) and a provider package, with the API key in the Zod env schema. *Done when:* a test call returns a reply from the model.
- [ ] **5.6** Write the prompt templates (system: role and rules; user: snapshot) as versioned files. *Done when:* the rendered prompt for a sample snapshot is logged and reads correctly.
- [ ] **5.7** Call `generateText` with `Output.object` and the `Decision` Zod schema, wrapped in a `cockatiel` timeout. *Done when:* tests with a mocked model show valid replies mapped, and invalid replies or timeouts turned into HOLD.
- [ ] **5.8** Store each decision with its reasoning and `validUntil` (Drizzle), and publish it. *Done when:* a row exists per snapshot and core receives the message.
- [ ] **5.9** Add a configuration switch `decider = rule | jev | rule-with-jev-veto`. *Done when:* changing the value changes behaviour without code changes.
- [ ] **5.10** Guarantee ordering per ticker with `channel.prefetch(1)`. *Done when:* a test sending two snapshots for the same ticker processes them in order.
- [ ] **5.11** Publish `trade.closed` through RabbitMQ instead of in-process. *Done when:* Jev logs each closed trade.

**Gate:** 48 hours with Jev deciding every candle, no crashes, and a HOLD every time the LLM fails.

## Phase 6 · Kronos service (Python)

Goal: core gets a forecast for each snapshot, and keeps working when Kronos is down.

- [ ] **6.1** Create the Python project with FastAPI and a `/health` endpoint. *Done when:* `uvicorn` starts and `/health` returns OK.
- [ ] **6.2** Load Kronos-small and its tokenizer at startup and run a forecast from a sample CSV in a script. *Done when:* the script prints predicted candles.
- [ ] **6.3** Implement `POST /forecast` with Pydantic request and response models (candles in; predicted candles and volatility out). *Done when:* a request with real bars returns a valid response.
- [ ] **6.4** Measure CPU latency for 512 candles and set core's timeout from it. *Done when:* the p95 latency is written down and the timeout is configured.
- [ ] **6.5** Write the Dockerfile with the CPU build of PyTorch and the model cached in the image or a volume. *Done when:* the container starts and answers `/forecast`.
- [ ] **6.6** Call Kronos from core with `fetch`, a `cockatiel` timeout and circuit breaker, and validate the response with a Zod schema. *Done when:* stopping Kronos produces degraded snapshots and the cycle still completes.
- [ ] **6.7** Check on historical data how often the forecast direction is right. *Done when:* the hit rate is reported against the 50% baseline.

**Gate:** snapshots include a forecast every hour, and you know whether it beats a coin flip.

## Phase 7 · Sentiment job

Goal: a fresh sentiment score per ticker, ready in Redis before each candle close, within a known cost.

- [ ] **7.1** Fetch the last 2 hours of Alpaca news for each ticker through the SDK. *Done when:* a log lists the headlines found.
- [ ] **7.2** Add a web search API client (Tavily or Brave) with `fetch` and a Zod response schema. *Done when:* a query for the ticker returns parsed results.
- [ ] **7.3** Write the sentiment prompt with `Output.object` and a `Sentiment` Zod schema (score −1 to 1, confidence, key drivers). *Done when:* a test with sample news returns a valid `Sentiment`.
- [ ] **7.4** Schedule the job with `croner` every 30–60 minutes; save to Redis (`ioredis`) with a TTL and to a Drizzle history table. *Done when:* Redis always holds a value under 2 hours old.
- [ ] **7.5** Make core read sentiment from Redis and flag it stale when too old. *Done when:* deleting the Redis key produces a snapshot with `stale = true`.
- [ ] **7.6** Record token usage from each AI SDK result and enforce a monthly budget. *Done when:* the logs or dashboard show cost per day, and the job stops at the cap.

**Gate:** sentiment present in every snapshot for 48 hours, with daily cost known.

## Phase 8 · Trade journal and memory

Goal: every closed trade is remembered, and Jev sees similar past setups when it decides.

- [ ] **8.1** Enable the pgvector extension and add a Drizzle table with a `vector` column and an HNSW index. *Done when:* a test inserts a vector and finds it with a cosine-distance query.
- [ ] **8.2** Write a text summary of a snapshot to embed (trend, indicators, forecast, sentiment). *Done when:* a unit test shows the summary for a sample snapshot.
- [ ] **8.3** On `trade.closed`, create the embedding with the AI SDK `embed` function and store it with metadata (ticker, decision, P&L, win or loss). *Done when:* each closed trade has one vector row, for wins and losses alike.
- [ ] **8.4** Retrieve the 5 most similar past trades and add them to Jev's prompt. *Done when:* the logged prompt includes them with their outcomes.
- [ ] **8.5** Design the Obsidian note template: YAML front matter (`gray-matter`) plus sections for context, reasoning and result. *Done when:* a sample note opens in Obsidian with its properties shown.
- [ ] **8.6** Write one note per closed trade to a persistent folder synced to your vault (Git or Syncthing). *Done when:* the note appears in Obsidian on your computer.
- [ ] **8.7** (Could) Expose trade-history queries as MCP tools with `@modelcontextprotocol/sdk`. *Done when:* an MCP client lists the tools and gets real results.

**Gate:** a week of trades is in the journal and Jev's prompts include similar past trades.

## Phase 9 · Auth, gateway and dashboard

Goal: a secure entry point and a dashboard that shows what the bot does and why.

- [ ] **9.1** In `auth-service`, install Better Auth and `@better-auth/drizzle-adapter`, generate the auth schema with the Better Auth CLI and run the migration. *Done when:* the user, session and account tables exist in Postgres.
- [ ] **9.2** Mount Better Auth on Express 5 (catch-all route `/api/auth/*splat`) with email and password enabled, and seed one admin user. *Done when:* signing in returns a session and the stored password is a hash.
- [ ] **9.3** Add the admin plugin for roles (ADMIN and VIEWER). *Done when:* the session shows the user's role.
- [ ] **9.4** Add the JWT plugin so signed-in users get a short-lived token and the service exposes its JWKS. *Done when:* the token decodes with the user and role, and the JWKS endpoint returns a key.
- [ ] **9.5** In `api-gateway`, proxy `/api/core` and `/api/jev` with `http-proxy-middleware`, verify the JWT with `jose` against the JWKS, and check roles per route. *Done when:* no token returns 401 and a VIEWER calling the kill switch returns 403.
- [ ] **9.6** Add `helmet`, CORS for the dashboard origin only, and `express-rate-limit` on the gateway. *Done when:* the dashboard can call the API, another origin cannot, and too many requests return 429.
- [ ] **9.7** Create the Vite + React + TypeScript app with shadcn/ui, TanStack Query, the Better Auth React client and a sign-in page. *Done when:* signing in redirects to the overview and signing out returns to the sign-in page.
- [ ] **9.8** Overview page: equity curve against buy-and-hold, open positions, kill switch state. *Done when:* the numbers match the database.
- [ ] **9.9** Trades page: each trade with its snapshot and Jev's reasoning. *Done when:* clicking a trade shows why it was taken.
- [ ] **9.10** Signals page: candle chart (Lightweight Charts) with indicators, latest Kronos forecast and sentiment. *Done when:* it refreshes after each candle close.
- [ ] **9.11** Admin page: kill switch, ticker toggles, risk parameters (forms with React Hook Form + Zod). *Done when:* changes take effect without restarting services.
- [ ] **9.12** Health page: service status, last candle processed, queue depth. *Done when:* stopping a service shows it as down.
- [ ] **9.13** (Should) Public read-only demo view. *Done when:* it opens without signing in and shows no admin controls.

**Gate:** you can sign in, follow every decision, and stop trading from the dashboard.

## Phase 10 · Home lab deployment and observability

Goal: the whole system runs 24/7 on k3s, deploys from CI and tells you when something breaks.

- [ ] **10.1** Install k3s on the home lab and connect `kubectl` from your laptop. *Done when:* `kubectl get nodes` shows the node `Ready`.
- [ ] **10.2** Write a multi-stage Dockerfile per service (build with TypeScript, run on a slim Bun image) and one for Kronos. *Done when:* each image builds locally and starts with `/health` answering.
- [ ] **10.3** Build and push the images to GitHub Container Registry from Jenkins. *Done when:* each push to `main` produces tagged images.
- [ ] **10.4** Install PostgreSQL + pgvector, Redis and RabbitMQ in the cluster with persistent volumes. *Done when:* data survives deleting their pods.
- [ ] **10.5** Store the API keys and secrets (Alpaca, LLM, Better Auth secret) as Sealed Secrets. *Done when:* the Git repo contains only encrypted secrets and the pods read them.
- [ ] **10.6** Write a Helm chart per service with resource limits and liveness and readiness probes, and run Drizzle migrations as a Kubernetes Job before each deploy. *Done when:* `helm install` brings every service to `Running` with the schema up to date.
- [ ] **10.7** Make Jenkins deploy to k3s after tests pass on `main`. *Done when:* a merged change reaches the cluster without manual steps.
- [ ] **10.8** Expose only the gateway and the dashboard through Cloudflare Tunnel (HTTPS). *Done when:* the dashboard opens from your phone on mobile data and the databases are unreachable from outside.
- [ ] **10.9** Install Prometheus, Grafana and Loki; expose `prom-client` metrics from each service and build a dashboard for candles processed, decisions, orders and errors. *Done when:* every service appears with its metrics and logs.
- [ ] **10.10** Add alerts to Telegram: missed candle, kill switch activated, service down. *Done when:* stopping core triggers an alert on your phone.
- [ ] **10.11** Schedule a daily Postgres backup and test a restore. *Done when:* a restore into a fresh database returns the trades.

**Gate:** the system survives a node reboot without manual steps and you get alerted when something fails.

## Phase 11 · Paper trading evaluation

Goal: decide with real numbers whether the system works, and turn the result into portfolio material.

- [ ] **11.1** Every week, record net return, drawdown and Sharpe against buy-and-hold. *Done when:* a weekly row exists in a results table.
- [ ] **11.2** Every month, review the Obsidian notes of losing and winning trades for patterns. *Done when:* a short monthly note lists what you observed.
- [ ] **11.3** Change strategy rules only after the change passes the backtest from Phase 3. *Done when:* every rule change has a linked backtest report.
- [ ] **11.4** Compare `rule`, `jev` and `rule-with-jev-veto` modes on the same period. *Done when:* a table shows which mode performed best.
- [ ] **11.5** After 3 months and ≥ 100 closed trades, make the go/no-go decision against the success metrics. *Done when:* the decision and its numbers are written in the SRS.
- [ ] **11.6** Write the portfolio README: architecture diagram, screenshots, results and lessons learned. *Done when:* someone new can understand the project in 5 minutes.

**Gate:** a documented result, positive or not, with the evidence behind it.
