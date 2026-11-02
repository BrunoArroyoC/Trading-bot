import { cronGetHourCandle, getTheLast512Bars1H, startConnectionAlpaca,  } from "./src/layers/alpaca/alpacaConnection.ts"
import { logger } from "./src/logger.ts";
import { Alpaca } from "@alpacahq/alpaca-trade-api";
import express, { type Express,  } from 'express';
import { pinoHttp } from "pino-http";
import { HourCandleManager } from "./src/layers/model/1HourCandleManager.ts";
import { BufferCandle } from "./src/layers/model/candleBuffer.ts";

const app: Express = express();

const eventClosedCandle = new HourCandleManager();
const bufferCandle: BufferCandle = new BufferCandle();


const TICKER = "BTC/USD";

// Prints one JSON log line per request.
app.use(pinoHttp({ logger }));

const alpaca = new Alpaca({
  keyId: process.env.APCA_API_KEY_ID,
  secret: process.env.APCA_API_SECRET_KEY,
  paper: true,
});

eventClosedCandle.waitForClosedCandle(({ticker, inserted, updated}) => {
  logger.info({ ticker, inserted, updated }, "Candle Close and reciving");
});

eventClosedCandle.addingToBUffer((candles) => {
  candles.forEach((candle) => bufferCandle.pushToBuffer(candle));
});


try {
  await startConnectionAlpaca(alpaca);
  await getTheLast512Bars1H(alpaca, TICKER, bufferCandle);
  cronGetHourCandle(alpaca, TICKER, eventClosedCandle);
} catch(err) {
  logger.fatal({ err }, "Startup failed: could not load or save 1H history");
    process.exit(1);
}

app.listen(3000, () => logger.info({ port: 3000 }, "core-service started"));
