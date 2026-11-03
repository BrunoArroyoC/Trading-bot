import { type Candle } from "../alpaca/model/candleZod";


const MAX_CANDLES = 512;


export class BufferCandle {
  // One list per ticker, so BTC and ETH candles never mix.
  bufferCandle: Map<string, Candle[]>
  constructor() {
    this.bufferCandle = new Map();
  }

  //Methods

  pushToBuffer(candle: Candle): void {
    let list = this.bufferCandle.get(candle.ticker);
    if (!list) {
      list = [];
      this.bufferCandle.set(candle.ticker, list);
    }

    const last = list.at(-1);
    // Same hour as the newest: the cron re-sends lastSaved, so replace instead of duplicating.
    if (last && candle.openTime.getTime() === last.openTime.getTime()) {
      list[list.length - 1] = candle;
      return;
    }
    // Older than the newest: already in the buffer.
    if (last && candle.openTime.getTime() < last.openTime.getTime()) return;

    list.push(candle);
    // Drop the oldest (the start of the list) so it never exceeds the limit.
    if (list.length > MAX_CANDLES) list.shift();
  }

  // The candles of one ticker, oldest first (empty if none yet). Used by the indicators (2.2).
  getCandles(ticker: string): Candle[] {
    return this.bufferCandle.get(ticker) ?? [];
  }
}
