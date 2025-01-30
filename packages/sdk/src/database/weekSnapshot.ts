import type { WeekIdFormatType } from '../week-functions';

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
