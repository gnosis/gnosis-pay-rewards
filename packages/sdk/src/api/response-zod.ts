import { z } from 'zod';
import { addressZodSchema, weekIdZodSchema } from '../database/common-zod.js';
import { gnosisPayTransactionFieldsZodSchema } from '../database/gnosis-pay-transaction-zod.js';
import { rewardTransactionFieldsZodSchema } from '../database/reward-transaction-zod.js';
import { estimatedRewardFieldsZodSchema } from '../database/safe-rewards-week-snapshot-zod.js';
import { indexerStateZodSchema } from '../indexr-state.js';

/**
 * Zod schema for populated token (only selected fields used in API responses)
 */
const populatedTokenZodSchema = z.object({
  address: addressZodSchema,
  decimals: z.number(),
  symbol: z.string(),
  name: z.string(),
});

/**
 * Zod schema for token balance snapshot with populated token
 * Note: When populated, only 'block', 'balance', 'week', and 'token' fields are selected
 */
const tokenBalanceSnapshotZodSchema = z.object({
  _id: z.string().regex(/^\d+\/0x[a-fA-F0-9]{40}\/0x[a-fA-F0-9]{40}$/),
  week: weekIdZodSchema,
  balance: z.number(),
  block: z.number(),
  token: populatedTokenZodSchema,
});

/**
 * Zod schema for Gnosis Pay transaction with populated token
 */
const gnosisPayTransactionWithTokenZodSchema = gnosisPayTransactionFieldsZodSchema.extend({
  token: z.union([addressZodSchema, populatedTokenZodSchema]),
});

/**
 * Zod schema for populated reward transaction
 */
const populatedRewardTransactionZodSchema = rewardTransactionFieldsZodSchema.extend({
  token: populatedTokenZodSchema,
});

/**
 * Zod schema for partially populated Gnosis Pay Safe (used in /pay/rewards)
 * Only address and isOG are populated
 */
const partialGnosisPaySafeZodSchema = z.object({
  _id: addressZodSchema,
  address: addressZodSchema,
  isOG: z.boolean(),
});

/**
 * Zod schema for partially populated Gnosis Pay Safe (nested in Metri Safe)
 * Only address, isOG, and owners are populated
 */
const partialGnosisPaySafeNestedZodSchema = z.object({
  _id: addressZodSchema,
  address: addressZodSchema,
  isOG: z.boolean(),
  owners: z.array(addressZodSchema),
});

/**
 * Zod schema for populated Metri Safe (used in /metri/rewards)
 * Only address, isOG, and owners are populated, with optional nested gnosisPaySafe
 */
const populatedMetriSafeZodSchema = z.object({
  _id: addressZodSchema,
  address: addressZodSchema,
  isOG: z.boolean(),
  owners: z.array(addressZodSchema),
  gnosisPaySafe: z.union([partialGnosisPaySafeNestedZodSchema, z.null()]).optional(),
});

/**
 * Base schema for safe week rewards snapshot data
 * Contains all common fields shared between /pay/rewards and /metri/rewards
 */
const baseSafeWeekRewardsSnapshotDataZodSchema = z.object({
  _id: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}\/0x[a-fA-F0-9]{40}$/),
  week: weekIdZodSchema,
  earnedRewards: z.array(populatedRewardTransactionZodSchema),
  netVolumeUSD: z.number(),
  transactions: z.array(z.union([z.string(), gnosisPayTransactionWithTokenZodSchema])),
  estimatedRewards: z.array(
    estimatedRewardFieldsZodSchema.extend({
      token: populatedTokenZodSchema,
    }),
  ),
  tokenBalanceSnapshots: z.array(z.union([z.string(), tokenBalanceSnapshotZodSchema])),
  minTokenBalance: z.record(addressZodSchema, z.number()),
  maxTokenBalance: z.record(addressZodSchema, z.number()),
});

/**
 * Zod schema for the safe week rewards snapshot data returned by GET /pay/rewards
 * The safe field is a partial Gnosis Pay Safe
 */
const payRewardsSnapshotDataZodSchema = baseSafeWeekRewardsSnapshotDataZodSchema.extend({
  safe: partialGnosisPaySafeZodSchema,
});

/**
 * Zod schema for the safe week rewards snapshot data returned by GET /metri/rewards
 * The safe field is a populated Metri Safe
 */
const metriRewardsSnapshotDataZodSchema = baseSafeWeekRewardsSnapshotDataZodSchema.extend({
  safe: populatedMetriSafeZodSchema,
});

/**
 * Zod schema for the complete response from GET /pay/rewards endpoint
 */
export const payRewardsResponseZodSchema = z.object({
  data: payRewardsSnapshotDataZodSchema,
  meta: z.object({
    status: z.literal(200),
  }),
});

/**
 * Zod schema for the complete response from GET /metri/rewards endpoint
 */
export const metriRewardsResponseZodSchema = z.object({
  data: metriRewardsSnapshotDataZodSchema,
  meta: z.object({
    status: z.literal(200),
  }),
});

/**
 * TypeScript type for GET /pay/rewards response
 */
export type GetPayRewardsResponseType = z.infer<typeof payRewardsResponseZodSchema>;

/**
 * TypeScript type for GET /metri/rewards response
 */
export type GetMetriRewardsResponseType = z.infer<typeof metriRewardsResponseZodSchema>;

/**
 * Zod schema for the complete response from GET /status endpoint
 */
export const statusResponseZodSchema = z.object({
  data: z.array(indexerStateZodSchema),
  meta: z.object({
    status: z.literal(200),
  }),
});

/**
 * TypeScript type for GET /status response
 */
export type GetStatusResponseType = z.infer<typeof statusResponseZodSchema>;

/**
 * Zod schema for a single metri safe minimum balance entry
 * Used in GET /metri/week-balances endpoint
 */
const metriSafeMinimumBalanceZodSchema = z.object({
  safe: addressZodSchema,
  isOG: z.boolean(),
  gnosisPaySafe: z
    .union([
      z.object({
        _id: addressZodSchema,
        address: addressZodSchema,
        isOG: z.boolean(),
        owners: z.array(addressZodSchema),
      }),
      z.null(),
    ])
    .optional(),
  minTokenBalance: z.record(addressZodSchema, z.number()),
});

/**
 * Zod schema for the complete response from GET /metri/week-balances endpoint
 */
export const metriWeekBalancesResponseZodSchema = z.object({
  data: z.array(metriSafeMinimumBalanceZodSchema),
  meta: z.object({
    status: z.literal(200),
  }),
});

/**
 * TypeScript type for GET /metri/week-balances response
 */
export type GetMetriWeekBalancesResponseType = z.infer<typeof metriWeekBalancesResponseZodSchema>;

/**
 * Zod schema for a single metri safe week rewards data summary entry
 * Used in POST /metri/week-rewards-data-summary endpoint
 */
const metriSafeWeekRewardsDataSummaryZodSchema = z.object({
  metriAddress: addressZodSchema,
  gnosisPayAddress: addressZodSchema.nullable(),
  minGnoBalance: z.number(),
  isOG: z.boolean(),
});

/**
 * Zod schema for the complete response from POST /metri/week-rewards-data-summary endpoint
 */
export const metriWeekRewardsDataSummaryResponseZodSchema = z.object({
  data: z.array(metriSafeWeekRewardsDataSummaryZodSchema),
  meta: z.object({
    status: z.literal(200),
  }),
});

/**
 * TypeScript type for POST /metri/week-rewards-data-summary response
 */
export type GetMetriWeekRewardsDataSummaryResponseType = z.infer<typeof metriWeekRewardsDataSummaryResponseZodSchema>;
