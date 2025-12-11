import { createLogger, format, Logger, transports } from 'winston';
import 'winston-mongodb';
import { mkdir } from 'node:fs/promises';
import DailyRotateFile from 'winston-daily-rotate-file';
import {
  LOGGER_FILE_TRANSPORT_DIR,
  LOGGER_FILE_TRANSPORT_ENABLED,
  LOGGER_FILE_TRANSPORT_FILENAME,
  LOGGER_FILE_TRANSPORT_MAX_FILES,
  LOGGER_FILE_TRANSPORT_MAX_SIZE,
  LOGGER_MONGODB_TRANSPORT_ENABLED,
  LOGGER_MONGODB_TRANSPORT_URI,
} from './config/env.ts';

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
      verbose: 5,
    },
    transports: [
      new transports.Console({
        format: consoleFormat,
      }),
    ],
  });

  if (
    LOGGER_MONGODB_TRANSPORT_ENABLED === true &&
    LOGGER_MONGODB_TRANSPORT_URI !== undefined
  ) {
    loggerInstance.add(
      new transports.MongoDB({
        db: LOGGER_MONGODB_TRANSPORT_URI,
        collection: 'logs',
        tryReconnect: true,
        format: format.combine(jsonFormat, format.timestamp()),
      }),
    );
  }

  if (LOGGER_FILE_TRANSPORT_ENABLED === true) {
    // Ensure the log directory exists
    try {
      await mkdir(LOGGER_FILE_TRANSPORT_DIR, { recursive: true });
    } catch (error) {
      console.error('Error creating log directory', error);
      throw error;
    }

    const fileTransport = new DailyRotateFile({
      dirname: LOGGER_FILE_TRANSPORT_DIR,
      filename: LOGGER_FILE_TRANSPORT_FILENAME,
      datePattern: 'YYYY-MM-DD',
      maxSize: LOGGER_FILE_TRANSPORT_MAX_SIZE,
      maxFiles: LOGGER_FILE_TRANSPORT_MAX_FILES,
      format: format.combine(format.timestamp(), jsonFormat),
      zippedArchive: true, // Compress old log files
    });

    loggerInstance.add(fileTransport);
  }

  return loggerInstance;
}
