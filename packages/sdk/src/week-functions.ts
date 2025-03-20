import dayjsCore from 'dayjs';
import dayjsUtcPlugin from 'dayjs/plugin/utc.js';
import updateLocalePlugin from 'dayjs/plugin/updateLocale.js';

dayjsCore.extend(dayjsUtcPlugin);
dayjsCore.extend(updateLocalePlugin);

const WEEK_ID_REGEX_STRICT = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_ID_REGEX_IN_STRING = /(\d{4}-\d{2}-\d{2})/;

export type WeekIdFormatType = 'YYYY-MM-DD';

/**
 * ISO 8601 date format
 */
export const weekIdFormat = 'YYYY-MM-DD' as const;

/**
 * Convert a Unix timestamp to a week data ID
 * @param unixTimestamp - The Unix timestamp
 * @param rollbackWeeks - The number of weeks to rollback, defaults to 0. For example, if you want to get the week data ID for the week that ended 2 weeks ago, you can pass `rollbackWeeks = 2`.
 * @returns The week data ID
 */
export function toWeekId(unixTimestamp: number | bigint, rollbackWeeks = 0): WeekIdFormatType {
  const weekStart = dayjsCore.unix(Number(unixTimestamp)).utc().startOf('week').subtract(rollbackWeeks, 'week');
  const yyyyMMDD = weekStart.format(weekIdFormat);

  return yyyyMMDD as WeekIdFormatType;
}

/**
 * Check if a week ID is valid
 * @param weekId - The week ID
 * @returns True if the week ID is valid, false otherwise
 */
export function isValidWeekId(weekIdish: string): weekIdish is WeekIdFormatType {
  // Must be a string in YYYY-MM-DD format
  const isCorrectFormat = weekIdish.match(WEEK_ID_REGEX_STRICT) !== null;

  // Must be a valid Sunday
  const isSunday = dayjsCore.utc(weekIdish).day() === 0;

  return isCorrectFormat && isSunday;
}

/**
 * Find the week data ID for a given Unix timestamp
 * @param unixTimestampOrString - The Unix timestamp
 * @returns The week data ID
 * @throws An error if the input is not a valid Unix timestamp or week data ID
 */
export function findWeekId(stringWithWeekId: string): WeekIdFormatType | null {
  if (typeof stringWithWeekId !== 'string') {
    throw new Error(`findWeekId: invalid value (${stringWithWeekId})`);
  }

  // find the YYYY-MM-DD format
  const matches = stringWithWeekId.match(WEEK_ID_REGEX_IN_STRING);

  if (matches && matches.length > 0) {
    return matches[0] as WeekIdFormatType;
  }

  return null;
}

/**
 * Get the current week id
 * @returns e.g. 2024-03-01
 */
export function getCurrentWeekId() {
  const now = dayjsCore.utc();
  return toWeekId(now.unix());
}
