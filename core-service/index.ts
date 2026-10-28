import { startConnectionAlpaca, getTheLast512Bars1H } from "./src/layers/alpaca/alpacaConnection.ts"
import { logger } from "./src/logger.ts";
import { Alpaca } from "@alpacahq/alpaca-trade-api";
import express, { type Express,  } from 'express';
import { pinoHttp } from "pino-http";
import { mapperCandle } from "./src/layers/alpaca/model/candleZod.ts";
import { upsertCandle } from "./src/layers/alpaca/candleRespository.ts";

const app: Express = express();

// Prints one JSON log line per request.
app.use(pinoHttp({ logger }));


const alpaca = new Alpaca({
  keyId: process.env.APCA_API_KEY_ID,
  secret: process.env.APCA_API_SECRET_KEY,
  paper: true,
});

try {
  await startConnectionAlpaca(alpaca);
  const ticker = "BTC/USD";
  const candles512 = await getTheLast512Bars1H(alpaca, ticker);
  const candles = candles512.map((bar) => mapperCandle(bar, ticker));

  if (candles.length < 512) {
    throw new Error(`Expected 512 1H bars for ${ticker}, got ${candles.length}`);
  }

  const {inserted, updated } = await upsertCandle(candles);
  logger.info({ ticker, inserted, updated, latestClosed: candles.at(-1)?.openTime }, "Saved 1H history");

} catch(err) {
  logger.fatal({ err }, "Startup failed: could not load or save 1H history");
    process.exit(1);
}

app.listen(3000, () => logger.info({ port: 3000 }, "core-service started"));
