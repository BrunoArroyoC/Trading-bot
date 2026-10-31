import EventEmitter from "events";

 const CANDLE_CLOSED = "candleClosed";

type ClosedCandlePayload = {
  ticker: string;
  inserted: number;
  updated: number;
};

type HourCandleEvents = {
  candleClosed: [payload: ClosedCandlePayload];
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

}
