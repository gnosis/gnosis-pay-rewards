import type { Address } from 'viem';
import type { WeekIdFormatType } from '../week-functions.js';
import { z } from 'zod';

/**
 * Zod schema for estimated rewards per token
 */
export const estimatedRewardFieldsZodSchema = z.object({
  token: z.string(),
  tokenPriceUSD: z.number(),
  tokenPriceEUR: z.number(),
  tokenPriceGBP: z.number(),
  valueUSD: z.number(),
  valueEUR: z.number(),
  valueGBP: z.number(),
  valuePercentage: z.number().describe('The value percentage of the reward in relation to the net volume USD'),
  amount: z.number(),
  amountRaw: z.string(),
});

export type EstimatedRewardFieldsType = z.infer<typeof estimatedRewardFieldsZodSchema>;

export type SafeWeekRewardsSnapshotDocumentFieldsType<
  TransactionsFieldType = string,
  TokenBalanceSnapshotFieldType = string,
  EarnedRewardsFieldType = string,
> = {
  _id: `${WeekIdFormatType}/${Address}`; // e.g. 2024-03-01/0x123456789abcdef123456789abcdef123456789ab
  safe: Address;
  week: WeekIdFormatType;
  /**
   * The actual reward transactions for the week.
   * References to RewardTransaction documents.
   * This is empty until rewards have been distributed.
   */
  earnedRewards: EarnedRewardsFieldType[];
  /**
   * The net USD volume of the user at the end of the week, refunds will reduce this number
   */
  netVolumeUSD: number;
  /**
   * The transactions that were used to calculate the cashback reward
   */
  transactions: TransactionsFieldType[];
  /**
   * The estimated rewards for the week
   * This is an array of objects with the token address, amount, and value in USD
   * @example
   * [
   *   { token: '0x123456789abcdef123456789abcdef123456789ab', valueUSD: 100 },
   *   { token: '0xabcdef123456789abcdef123456789abcdef123456789ab',valueUSD: 200 },
   * ]
   */
  estimatedRewards: EstimatedRewardFieldsType[];
  /**
   * The GNO balance snapshots of the user at the end of the week
   */
  tokenBalanceSnapshots: TokenBalanceSnapshotFieldType[];
};
