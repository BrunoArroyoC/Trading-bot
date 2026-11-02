import { type Candle } from "../alpaca/model/candleZod";


const MAX_CANDLES = 512;


export class BufferCandle {
  bufferCandle: Candle[]

  constructor() {
    this.bufferCandle = [];
  }

  //Methods

  pushToBuffer(candle: Candle): void {
    const last = this.bufferCandle.at(-1);
    // Same hour as the newest: the cron re-sends lastSaved, so replace instead of duplicating.
    if (last && candle.openTime.getTime() === last.openTime.getTime()) {
      this.bufferCandle[this.bufferCandle.length - 1] = candle;
      return;
    }
    // Older than the newest: already in the buffer.
    if (last && candle.openTime.getTime() < last.openTime.getTime()) return;

    this.bufferCandle.push(candle);
    // Drop the oldest (the start of the list) so it never exceeds the limit.
    if (this.bufferCandle.length > MAX_CANDLES) this.bufferCandle.shift();
  }
}
