import { dayjsUtc } from '../dayjs-utc';

const WEEK_ID_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export type WeekSnapshotDocumentFieldsType = {
  /**
   * Week date in YYYY-MM-DD format,
   * @deprecated Use `weekId` instead
   */
  date: string;
  /**
   * Week date in YYYY-MM-DD format
   */
  week: WeekIdFormatType;
  /**
   * Total USD volume for the week
   */
  netUsdVolume: number;
  /**
   * Transactions for the week
   */
  transactions: string[];
};

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
  const weekStart = dayjsUtc(Number(unixTimestamp)).utc().startOf('week').subtract(rollbackWeeks, 'week');
  const yyyyMMDD = weekStart.format(weekIdFormat);

  return yyyyMMDD as WeekIdFormatType;
}

/**
 * Check if a week ID is valid
 * @param weekId - The week ID
 * @returns True if the week ID is valid, false otherwise
 */
export function isValidWeekId(weekIdish: string): boolean {
  return weekIdish.match(WEEK_ID_REGEX) !== null; // YYYY-MM-DD
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
  const yyyyMMDD = stringWithWeekId.match(WEEK_ID_REGEX);

  if (yyyyMMDD && yyyyMMDD.length > 0) {
    return yyyyMMDD[0] as WeekIdFormatType;
  }

  return null;
}
