import { startConnectionAlpaca, getTheLast512Bars1H } from "./src/layers/alpaca/alpacaConnection.ts"
import { logger } from "./src/logger.ts";
import { Alpaca } from "@alpacahq/alpaca-trade-api";
import express, { type Express, type Request, type Response } from 'express';
import { pinoHttp } from "pino-http";
import { mapperCandle } from "./src/layers/alpaca/model/candleZod.ts";

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
  logger.info(
    { ticker, count: candles512.length, latestClosed: candles512.at(-1)?.timestamp },
    "Loaded 1H history",
  );

  if (candles.length < 512) {
    throw new Error(`Expected 512 1H bars for ${ticker}, got ${candles.length}`);
  }

} catch(err) {
  logger.fatal({ err }, "Startup failed: could not load data from Alpaca");
    process.exit(1);
}

app.listen(3000, () => logger.info({ port: 3000 }, "core-service started"));
