import { Alpaca } from "@alpacahq/alpaca-trade-api";



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


let groupCandles: StreamBar[] = [];

const alpaca = new Alpaca({
  keyId: process.env.APCA_API_KEY_ID,
  secret: process.env.APCA_API_SECRET_KEY,
  paper: true,
});

//Start Connection
  const account = await alpaca.trading.account.getAccount();
  console.log(account.status, account.buyingPower);


//Connection stream with websocket
const crypto = alpaca.marketData.cryptoStream({loc: "eu-1"});
//crypto.onBar((bar) => groupCandles.push(bar) );
crypto.onError((msg) => console.error("stream error:", msg));
crypto.onConnect(() => crypto.subscribeForBars(["BTC/USD"]));
crypto.connect();



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
