import { Alpaca } from "@alpacahq/alpaca-trade-api";
import { logger } from "../../logger.ts";


export async function startConnectionAlpaca(alpaca: Alpaca) {
  const account = await alpaca.trading.account.getAccount();
  logger.info({ status: account.status, buyingPower: account.buyingPower }, "Alpaca account loaded");
  return account;
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
