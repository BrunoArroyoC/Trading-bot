import { startConnectionAlpaca } from "./src/layers/alpaca/alpacaConnection.ts"
import { logger } from "./src/logger.ts";
import { Alpaca } from "@alpacahq/alpaca-trade-api";
import express, { type Express, type Request, type Response } from 'express';
import { pinoHttp } from "pino-http";

const app: Express = express();

// Prints one JSON log line per request.
app.use(pinoHttp({ logger }));

app.get('/start', async (req: Request, res: Response) => {
  const alpaca = new Alpaca({
    keyId: process.env.APCA_API_KEY_ID,
    secret: process.env.APCA_API_SECRET_KEY,
    paper: true,
  });
  try {
    const userAccount = await startConnectionAlpaca(alpaca);
    res.status(200).json({ ok: true, status: userAccount.status, buyingPower: userAccount.buyingPower })
  } catch (e) {
    req.log.error({ err: e }, "Failed to connect to Alpaca");
    res.status(500).json({ ok: false, error: "Failed to connect" });
  }
});


app.listen(3000, () => logger.info({ port: 3000 }, "core-service started"));
