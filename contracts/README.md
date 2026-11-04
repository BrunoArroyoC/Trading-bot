# contracts

Sample messages exchanged between Jev's services. Each service declares its own Zod schemas and
its tests parse these files, so a shape change that isn't updated everywhere fails a test (NFR-11).
The file name ends in the `schemaVersion` it follows (`.v1.json`); a breaking change adds a `.v2.json`.

| File | Message | From → To |
|---|---|---|
| `market-snapshot.v1.json` | MarketSnapshot, complete | core → jev (`analysis.requests`), stored in `snapshots.data` |
| `market-snapshot-degraded.v1.json` | MarketSnapshot, Kronos down and old sentiment | core → jev |
| `decision.v1.json` | Decision | jev → core (`decisions`) |
| `kronos-forecast.v1.json` | KronosForecast | kronos → core (REST response) |
| `sentiment.v1.json` | Sentiment | jev sentiment job → Redis → core |
