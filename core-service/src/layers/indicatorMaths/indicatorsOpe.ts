import { RSI, MACD, EMA, ATR, SMA, BollingerBands, type HighLowClose } from "trading-signals";
import type { Candle } from "../alpaca/model/candleZod";

export class IndicatorsOp {

  constructor() {
  }



  flowIndicator(ticker: string, candles: Candle[])  {
    const rsi = new RSI(14);
    const ema1 = new EMA(12);
    const ema2 = new EMA(26);
    const ema3 = new EMA(9);
    const macd = new MACD(ema1, ema2, ema3);
    const atr = new ATR(14);
    const emaIndi1 = new EMA(20);
    const emaIndi2 = new EMA(50);
    const emaIndi3 = new EMA(200);
    const sma = new SMA(20);
    const bollinger = new BollingerBands(20,2);

    candles.forEach((candle) => {
      rsi.update(Number(candle.close), false);
      macd.update(Number(candle.close), false);
      const newClosePrice: HighLowClose = {
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      };
      atr.update(newClosePrice, false);
      emaIndi1.update(Number(candle.close), false);
      emaIndi2.update(Number(candle.close), false);
      emaIndi3.update(Number(candle.close), false);
      sma.update(Number(candle.volume), false);
      bollinger.update(Number(candle.close), false);

    });
    return {
      ticker: ticker,
      rsi: rsi.getResult(),
      macd: macd.getResult(),
      atr: atr.getResult(),
      ema1: emaIndi1.getResult(),
      ema2: emaIndi2.getResult(),
      ema3: emaIndi3.getResult(),
      sma: sma.getResult(),
      bollinger: bollinger.getResult(),
    }

  }
}
