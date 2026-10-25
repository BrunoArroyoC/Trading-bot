import { startConnectionAlpaca, getTheLast512Bars1H } from "./src/layers/alpaca/alpacaConnection.ts"
import { logger } from "./src/logger.ts";
import { Alpaca } from "@alpacahq/alpaca-trade-api";
import express, { type Express, type Request, type Response } from 'express';
import { pinoHttp } from "pino-http";

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
  logger.info(
    { ticker, count: candles512.length, latestClosed: candles512.at(-1)?.timestamp },
    "Loaded 1H history",
  );
} catch(err) {
  logger.fatal({ err }, "Startup failed: could not load data from Alpaca");
    process.exit(1);
}


/*
app.get('/start', async (req: Request, res: Response) => {
  const alpaca = new Alpaca({
    keyId: process.env.APCA_API_KEY_ID,
    secret: process.env.APCA_API_SECRET_KEY,
    paper: true,
  });
  try {
    const userAccount = await startConnectionAlpaca(alpaca);
    res.status(200).json({ ok: true, status: userAccount.status, buyingPower: userAccount.buyingPower })

    const trades = await getTheLast512Bars1H(alpaca);
    console.log(trades);
  } catch (e) {
    req.log.error({ err: e }, "Failed to connect to Alpaca");
    res.status(500).json({ ok: false, error: "Failed to connect" });
  }
});

*/



app.listen(3000, () => logger.info({ port: 3000 }, "core-service started"));
