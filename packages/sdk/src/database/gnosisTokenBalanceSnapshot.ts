import type { Address } from 'viem';
import type { WeekIdFormatType } from '../week-functions';

export type GnosisTokenBalanceSnapshotDocumentType = {
  _id: `${number}/${Address}`;
  weekId: WeekIdFormatType;
  safe: Address;
  balanceRaw: string;
  balance: number;
  blockNumber: number;
  blockTimestamp: number;
};
