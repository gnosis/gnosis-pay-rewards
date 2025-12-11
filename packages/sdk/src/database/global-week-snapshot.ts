import type { WeekIdFormatType } from '../week-functions.js';

export type WeekSnapshotDocumentFieldsType = {
  /**
   * Week date in YYYY-MM-DD format
   */
  week: WeekIdFormatType;
  /**
   * Transactions for the week
   */
  transactions: string[];
};
