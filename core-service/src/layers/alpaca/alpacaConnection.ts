import { Alpaca, timeFrame, TimeFrameUnit, type Bar} from "@alpacahq/alpaca-trade-api";
import { logger } from "../../logger.ts";
import { addBarToHour, checkBar, convertToHourCandle} from "./model/candleZod.ts";
import { upsertCandle} from "./candleRespository.ts";


export async function startConnectionAlpaca(alpaca: Alpaca) {
  const account = await alpaca.trading.account.getAccount();
  logger.info({ status: account.status, buyingPower: account.buyingPower }, "Alpaca account loaded");
  return account;
}



const HISTORY_BARS = 512;
const HOUR_MS = 60 * 60 * 1000;

// Returns the last 512 closed 1H bars for one ticker, oldest first.
export async function getTheLast512Bars1H(alpaca: Alpaca, ticker: string) {
  // A bar's timestamp is the START of its hour, so the bar of the current hour is still open.
  const currentHourStart = new Date();
  currentHourStart.setUTCMinutes(0, 0, 0);

  const bars = await alpaca.marketData.getCryptoBars({
    loc: "us-1",
    symbols: [ticker],
    timeframe: timeFrame(1, TimeFrameUnit.Hour),
    // A few extra hours in case Alpaca has an hour with no bar.
    start: new Date(currentHourStart.getTime() - (HISTORY_BARS + 8) * HOUR_MS),
  });

  const closedBars = (bars[ticker] ?? []).filter((bar) => bar.timestamp < currentHourStart);
  return closedBars.slice(-HISTORY_BARS);
}

//Variable to the connection


//Connection to the WebSocket
export async function webSocketAlpaca(alpaca: Alpaca, ticker: string) {
  // Minute bars of the hour being collected; replaced (not emptied) when the hour closes.
  let currentHour: Bar[] = [];
  const crypto = alpaca.marketData.cryptoStream({loc: "us-1",});
  crypto.onBar( async (bar) => {
    logger.info({ bar }, "Minute bar received")
    //Check the bar: skip a bad one and keep the stream running.
    if (!checkBar(bar, ticker).ok) {
      logger.warn({ bar }, "Skipped invalid minute bar");
      return;
    }

    //Queue: the bar either joins the current hour or closes it.
    const routed = addBarToHour(currentHour, bar);
    currentHour = routed.currentHour;
    if (!routed.closedHour) return;

    //The previous hour is complete: build its candle and save it.
    const new1HourCandle = convertToHourCandle(routed.closedHour, ticker);
    // `candle` only exists when ok is true; skip the save otherwise.
    if (!new1HourCandle.ok) {
      logger.warn({ ticker, bars: routed.closedHour.length, error: new1HourCandle.error }, "Could not build 1H candle");
      return;
    }
    try {
      // upsertCandle takes an array, so a single candle goes in as [candle].
      const { inserted, updated } = await upsertCandle([new1HourCandle.candle]);
      logger.info({ ticker, inserted, updated, openTime: new1HourCandle.candle.openTime }, "Saved closed 1H candle");
    } catch (err) {
      logger.error({ err, ticker }, "Could not save 1H candle");
    }
  });
  crypto.onError((msg) => logger.warn({ err: msg }, "WebSocket error"));
  crypto.onConnect(() => crypto.subscribeForBars([ticker]));
  crypto.connect();
  crypto.onDisconnect(() => logger.warn("WebSocket disconnected"));

}
