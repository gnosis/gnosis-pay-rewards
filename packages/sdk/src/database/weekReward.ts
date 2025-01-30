import type { Address } from 'viem';
import type { WeekIdFormatType } from '../week-functions';
import type { GnosisPayTransactionFieldsType_Unpopulated } from './spendTransaction';
import type { GnosisTokenBalanceSnapshotDocumentType } from './gnosisTokenBalanceSnapshot';

export type WeekCashbackRewardDocumentFieldsTypeBase<TransactionsFieldType, GnosisTokenBalanceSnapshotFieldType> = {
  _id: `${WeekIdFormatType}/${Address}`; // e.g. 2024-03-01/0x123456789abcdef123456789abcdef123456789ab
  safe: Address;
  week: WeekIdFormatType;
  /**
   * The estimated reward for the week
   */
  estimatedReward: number;
  /**
   * The actual reward for the week.
   * This is null until the reward has been distributed.
   */
  earnedReward: number | null;
  /**
   * The highest GNO balance of the user at the end of the week
   */
  maxGnoBalance: number;
  /**
   * The lowest GNO balance of the user at the end of the week
   */
  minGnoBalance: number;
  /**
   * The net USD volume of the user at the end of the week, refunds will reduce this number
   */
  netUsdVolume: number;
  /**
   * The transactions that were used to calculate the cashback reward
   */
  transactions: TransactionsFieldType[];
  /**
   * The GNO balance snapshots of the user at the end of the week
   */
  gnoBalanceSnapshots: GnosisTokenBalanceSnapshotFieldType[];
};

export type WeekCashbackRewardDocumentFieldsType_Unpopulated = WeekCashbackRewardDocumentFieldsTypeBase<string, string>;
export type WeekCashbackRewardDocumentFieldsType_Populated = WeekCashbackRewardDocumentFieldsTypeBase<
  GnosisPayTransactionFieldsType_Unpopulated,
  GnosisTokenBalanceSnapshotDocumentType
>;
