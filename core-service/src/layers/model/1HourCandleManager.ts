import EventEmitter from "events";
import type { Candle } from "../alpaca/model/candleZod";

const CANDLE_CLOSED = "candleClosed";
const BUFFER_CANDLES = "candles";

type ClosedCandlePayload = {
  ticker: string;
  inserted: number;
  updated: number;
};

type HourCandleEvents = {
  candleClosed: [payload: ClosedCandlePayload];
  candles: [bufferCandles: Candle[]];
};
export class HourCandleManager extends EventEmitter<HourCandleEvents> {
  constructor() {
    super();
  }

  waitForClosedCandle( callback: (playload: ClosedCandlePayload)=> void) {
    this.on(CANDLE_CLOSED, callback);
  }

  notificactionHourCandle(args: ClosedCandlePayload ) {
    this.emit(CANDLE_CLOSED, args);
  }

  addingToBUffer(callback: (candle: Candle[]) => void ): void {
    this.on(BUFFER_CANDLES, callback);
  }

  notificationToBuffer(args: Candle[]) {
    this.emit(BUFFER_CANDLES, args);
  }


}
