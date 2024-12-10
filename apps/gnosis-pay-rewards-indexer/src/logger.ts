import { createLogger, transports, format, Logger } from 'winston';
import 'winston-mongodb';
import { MONGODB_URI } from './config/env.js';

let loggerInstance: Logger | null = null;

const jsonFormat = format.json({ space: 2, bigint: true });

const consoleFormat = format.combine(format.timestamp(), jsonFormat);

/**
 * Get the logger instance for logging to MongoDB
 */
export async function getLogger() {
  if (loggerInstance) {
    return loggerInstance;
  }

  loggerInstance = createLogger({
    levels: {
      error: 0,
      warn: 1,
      info: 2,
      http: 3,
      debug: 4,
    },
    transports: [
      // write errors to console too
      new transports.Console({
        format: consoleFormat,
      }),
      new transports.MongoDB({
        db: MONGODB_URI,
        collection: 'logs',
        tryReconnect: true,
        format: format.combine(jsonFormat, format.timestamp()),
      }),
    ],
  });

  return loggerInstance;
}
