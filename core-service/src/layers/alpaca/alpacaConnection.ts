import { Alpaca, timeFrame, TimeFrameUnit} from "@alpacahq/alpaca-trade-api";
import { logger } from "../../logger.ts";
import { mapperCandle} from "./model/candleZod.ts";
import { upsertCandle} from "./candleRespository.ts";
import { Cron } from "croner";
import type { HourCandleManager } from "../model/1HourCandleManager.ts";
import { circuitBreaker, ConsecutiveBreaker, ExponentialBackoff, handleAll, retry, wrap } from "cockatiel";


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

export async function getTheLast512Bars1H(alpaca: Alpaca, ticker: string) {
  const currentHourStart = new Date();
  currentHourStart.setUTCMinutes(0, 0, 0);
  const dataRetry = await retryBreaker.execute( async () => {
    const bars = await alpaca.marketData.getCryptoBars({
      loc: "us-1",
      symbols: [ticker],
      timeframe: timeFrame(1, TimeFrameUnit.Hour),
      // A few extra hours in case Alpaca has an hour with no bar.
      start: new Date(currentHourStart.getTime() - (HISTORY_BARS + 8) * HOUR_MS),
     });
    return bars;
  });

  const closedBars = (dataRetry[ticker] ?? []).filter((bar) => bar.timestamp < currentHourStart).slice(-HISTORY_BARS);
  const candles = closedBars.map((bar) => mapperCandle(bar, ticker));
  if (candles.length < 512) {
    throw new Error(`Expected 512 1H bars for ${ticker}, got ${candles.length}`);
  }
  const { inserted, updated } = await upsertCandle(candles);
  logger.info({ ticker, inserted, updated, latestClosed: candles.at(-1)?.openTime }, "Saved 1H history");


}



export function cronGetHourCandle(alpaca: Alpaca, ticker: string, event: HourCandleManager) {
  new Cron('0 1 * * * * *', { timezone: "UTC", protect: true }, async () => {
    try {
      const currentHourStart = new Date();
      currentHourStart.setUTCMinutes(0, 0, 0);
      const auxCandle = await retryBreaker.execute( async () => {
        const bars = await alpaca.marketData.getCryptoBars({
          loc: "us-1",
          symbols: [ticker],
          timeframe: timeFrame(1, TimeFrameUnit.Hour),
          start: new Date(currentHourStart.getTime() - (3 + 8) * HOUR_MS),
        });
        const closedBars = (bars[ticker] ?? []).filter((bar) => bar.timestamp < currentHourStart).slice(-3);
        const candles = closedBars.map((bar) => mapperCandle(bar, ticker));
        const newest = candles.at(-1);
        if (!newest || newest.openTime.getTime() !== currentHourStart.getTime() - HOUR_MS) {
          throw new Error("Closed hour not published yet");
        }
        return candles;
      });

      const result = await upsertCandle(auxCandle);
      event.notificactionHourCandle({ ticker, inserted: result.inserted,updated: result.updated });
      logger.info({ ticker, inserted: result.inserted,updated: result.updated }, "Save 1Hour candle");
    } catch (err) {
      logger.error({ err, ticker }, "Save 1Hour candle failed");
    }
  });
}
