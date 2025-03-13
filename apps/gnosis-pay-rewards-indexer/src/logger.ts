import { createLogger, transports, format, Logger } from 'winston';
import 'winston-mongodb';
import { LOGGER_MONGODB_TRANSPORT_URI, LOGGER_MONGODB_TRANSPORT_ENABLED } from './config/env.js';

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
    level: 'debug',
    levels: {
      error: 0,
      warn: 1,
      info: 2,
      http: 3,
      debug: 4,
    },
    transports: [
      new transports.Console({
        format: consoleFormat,
      }),
    ],
  });

  if (LOGGER_MONGODB_TRANSPORT_ENABLED === true && LOGGER_MONGODB_TRANSPORT_URI !== undefined) {
    loggerInstance.add(
      new transports.MongoDB({
        db: LOGGER_MONGODB_TRANSPORT_URI,
        collection: 'logs',
        tryReconnect: true,
        format: format.combine(jsonFormat, format.timestamp()),
      }),
    );
  }

  return loggerInstance;
}
