import { Alpaca, timeFrame, TimeFrameUnit } from "@alpacahq/alpaca-trade-api";
import { logger } from "../../logger.ts";


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


/*
type StreamBar = {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: Date;
  timestampRaw: string | undefined;
  vwap: number;
  tradeCount: number;

}

*/



/*
{
  symbol: "BTC/USD",
  open: 80455.8,
  high: 80471.1,
  low: 80455.55,
  close: 80457.05,
  volume: 0.11791166,
  timestamp: 2026-10-25T12:01:00.000Z,
  timestampRaw: "2026-10-25T12:01:00.000000000Z",
  vwap: 80464.8870637645,
  tradeCount: 74,
}

*/


//All the functions from alpaca
