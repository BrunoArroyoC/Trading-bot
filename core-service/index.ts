import { cronGetHourCandle, getTheLast512Bars1H, startConnectionAlpaca,  } from "./src/layers/alpaca/alpacaConnection.ts"
import { logger } from "./src/logger.ts";
import { Alpaca } from "@alpacahq/alpaca-trade-api";
import express, { type Express,  } from 'express';
import { pinoHttp } from "pino-http";
import { HourCandleManager } from "./src/layers/model/1HourCandleManager.ts";
import { BufferCandle } from "./src/layers/model/candleBuffer.ts";
import { IndicatorsOp } from "./src/layers/indicatorMaths/indicatorsOpe.ts";
import { buildSnapShot, indicatorSchema } from "./src/layers/model/snapshotZod.ts";
import { extractCandleByClosedTime, extractTimeLastClosedCandle } from "./src/layers/alpaca/candleRespository.ts";
import { buildSnap } from "./src/layers/repository/utilsRepository.ts";


const app: Express = express();

const eventClosedCandle = new HourCandleManager();
const bufferCandle: BufferCandle = new BufferCandle();
const indicatorOp: IndicatorsOp = new IndicatorsOp();

const HOUR_MS = 60 * 60 * 1000;
const TICKER = ["BTC/USD"];

// Prints one JSON log line per request.
app.use(pinoHttp({ logger }));

const alpaca = new Alpaca({
  keyId: process.env.APCA_API_KEY_ID,
  secret: process.env.APCA_API_SECRET_KEY,
  paper: true,
});

eventClosedCandle.waitForClosedCandle(async ({ ticker, inserted, updated }) => {
  logger.info({ ticker, inserted, updated }, "Candle Close and reciving");
  try {
    const result = indicatorOp.flowIndicator(ticker, bufferCandle.getCandles(ticker));
    logger.info({ ticker, indicators: result }, "Indicators calculated");
    const timeClosed = await extractTimeLastClosedCandle(ticker);
    const openTime = timeClosed[0]?.openTime;
    if (!openTime) {
      logger.warn({ ticker }, "No closed candle, no snapshot (HOLD)");
      return;
    }

    const closedCandle = await extractCandleByClosedTime(openTime, ticker);
    const candle = closedCandle[0];
    if (!candle) return;

    const snap = buildSnapShot(
      ticker,
      new Date(openTime.getTime() + HOUR_MS),
      {
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume: Number(candle.volume),
      },
      indicatorSchema.parse(result), // throws if an indicator is still null → catch → HOLD
    );

    const saveResult = await buildSnap(ticker, new Date(snap.candleCloseTime), snap.degraded, snap);
    logger.info({ ticker, snapshotId: snap.snapshotId, saved: saveResult.inserted }, "Snapshot built");
  } catch (err) {
     logger.error({ err, ticker }, "Snapshot failed, no decision this hour (HOLD)");
  }
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
