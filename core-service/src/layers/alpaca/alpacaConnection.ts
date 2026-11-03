import { Alpaca, timeFrame, TimeFrameUnit} from "@alpacahq/alpaca-trade-api";
import { logger } from "../../logger.ts";
import { mapperCandle, type Candle} from "./model/candleZod.ts";
import { extractTimeLastClosedCandle, upsertCandle} from "./candleRespository.ts";
import { Cron } from "croner";
import type { HourCandleManager } from "../model/1HourCandleManager.ts";
import { circuitBreaker, ConsecutiveBreaker, ExponentialBackoff, handleAll, retry, wrap } from "cockatiel";
import type { BufferCandle } from "../model/candleBuffer.ts";


const retryPolicy = retry(handleAll, { maxAttempts: 4, backoff: new ExponentialBackoff({ initialDelay: 10_000, maxDelay: 60_000 }) });
retryPolicy.onRetry(({ delay }) => logger.warn({ delay }, "Retrying hourly candle fetch"));
const circuitBreakerPolicy = circuitBreaker(handleAll, {
  halfOpenAfter: 10 * 1000,
  breaker: new ConsecutiveBreaker(5),
})

const retryBreaker = wrap(retryPolicy, circuitBreakerPolicy);


export async function startConnectionAlpaca(alpaca: Alpaca) {
  const account = await alpaca.trading.account.getAccount();
  logger.info({ status: account.status, buyingPower: account.buyingPower }, "Alpaca account loaded");
}

const HISTORY_BARS = 512;
const HOUR_MS = 60 * 60 * 1000;

export async function getTheLast512Bars1H(alpaca: Alpaca, ticker: string[], bufferCandle: BufferCandle) {
  const currentHourStart = new Date();
  currentHourStart.setUTCMinutes(0, 0, 0);
  const dataRetry = await retryBreaker.execute( async () => {
    const bars = await alpaca.marketData.getCryptoBars({
      loc: "us-1",
      symbols: ticker,
      timeframe: timeFrame(1, TimeFrameUnit.Hour),
      // A few extra hours in case Alpaca has an hour with no bar.
      start: new Date(currentHourStart.getTime() - (HISTORY_BARS + 8) * HOUR_MS),
     });
    return bars;
  });


  const mapOfTicker: Map<string, Candle[]> = new Map();
  ticker.forEach((tick) => mapOfTicker.set(tick, (dataRetry[tick] ?? [])
      .filter((bar) => bar.timestamp < currentHourStart)
      .slice(-HISTORY_BARS)
      .map((bar) => mapperCandle(bar, tick))));

  mapOfTicker.forEach((candles, tick) => {
    if (candles.length < 512) throw new Error(`Expected 512 1H bars for ${tick}, got ${candles.length}`);
  });

  for (const [tick, candles] of mapOfTicker) {
    const { inserted, updated } = await upsertCandle(candles);
    candles.forEach((candle) => bufferCandle.pushToBuffer(candle));
    logger.info({ tick, inserted, updated, lastestClosed: candles.at(-1)?.openTime }, "Save 1H history");
  }
}



export async function cronGetHourCandle(alpaca: Alpaca, ticker: string[], event: HourCandleManager) {
  new Cron('0 1 * * * * *', { timezone: "UTC", protect: true }, async () => {
    for (const tick of ticker) {
      try {
        const auxOpentimeList = await extractTimeLastClosedCandle(tick);
        if (!auxOpentimeList[0]?.openTime) {
          logger.warn({ tick }, "No saved candle to start from");
          continue;
        }
        const auxOpenTime = auxOpentimeList[0].openTime;
        auxOpenTime.setUTCMinutes(0, 0, 0);
        const lastSaved = auxOpenTime;
        const currentHourStart = new Date();
        currentHourStart.setUTCMinutes(0, 0, 0);

        const auxCandle = await retryBreaker.execute(async () => {
          const bars = await alpaca.marketData.getCryptoBars({
            loc: "us-1",
            symbols: tick,
            timeframe: timeFrame(1, TimeFrameUnit.Hour),
            start: lastSaved,
            //start: new Date(lastSaved.getTime() - (3 + 8) * HOUR_MS),  //To try later in testing,
          });
          const closedBars = (bars[tick] ?? []).filter((bar) => bar.timestamp < currentHourStart);
          const candles = closedBars.map((bar) => mapperCandle(bar, tick));
          const newest = candles.at(-1);
          if (!newest || newest.openTime.getTime() !== currentHourStart.getTime() - HOUR_MS) {
            throw new Error("Closed hour not published yet");
          }
          return candles;
        });
        const result = await upsertCandle(auxCandle);
        event.notificationToBuffer(auxCandle);
        event.notificactionHourCandle({ ticker: tick, inserted: result.inserted, updated: result.updated });
        logger.info({ tick, inserted: result.inserted, updated: result.updated }, "Save 1Hour candle");
      }catch (err) {
        logger.error({ err, tick }, "Save 1Hour candle failed");
      }
    }
  });
}
