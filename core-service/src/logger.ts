import { pino } from "pino";

// One JSON logger for the whole service; pino-http reuses it for request logs.
export const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
