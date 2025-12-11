import { addressZodSchema, weekIdZodSchema, weekIdZodSchemaWithDefault } from '@kpk/gnosis-pay-rewards-sdk/api';
import { z } from 'zod';

import { dayjsUtc as dayjs } from '../lib/dayjs-utc.ts';

export const paginationQueryZodSchema = z.object({
  limit: z.coerce.number().optional().default(100),
  page: z.coerce.number().optional().default(1),
});

export type GetPaginationQueryType = z.infer<typeof paginationQueryZodSchema>;

export const getPayTransactionsQueryZodSchema = z.object({
  ...paginationQueryZodSchema.shape,
  safe: addressZodSchema.optional(),
  week: weekIdZodSchema.optional(),
  'sort-by': z.enum(['block', 'amount', 'valueUSD']).optional().default('block'),
  'sort-order': z.enum(['asc', 'desc']).optional().default('desc'),
});

export type GetPayTransactionsQueryType = z.infer<
  typeof getPayTransactionsQueryZodSchema
>;

export const getAllWeeksSnapshotsQueryZodSchema = z.object({
  week: weekIdZodSchema,
});

export type GetAllWeeksSnapshotsQueryZodSchemaType = z.infer<
  typeof getAllWeeksSnapshotsQueryZodSchema
>;

export const getPayDistributionsSummaryQueryZodSchema = z.object({
  safe: addressZodSchema.optional(),
  week: weekIdZodSchema.optional(),
});

export type GetPayDistributionsSummaryQueryZodSchemaType = z.infer<
  typeof getPayDistributionsSummaryQueryZodSchema
>;

/**
 * Safe week rewards summary query schema
 * If no week is provided, the current week is used
 * @example
 * {
 *   safe: '0x1234567890123456789012345678901234567890',
 *   week: '2025-W46'
 * }
 */
export const getGnosisPaySafeWeekRewardsSummaryQueryZodSchema = z.object({
  safe: addressZodSchema,
  week: weekIdZodSchemaWithDefault,
});

export type GetGnosisPaySafeWeekRewardsSummaryQueryZodSchemaType = z.infer<
  typeof getGnosisPaySafeWeekRewardsSummaryQueryZodSchema
>;

export const getGnosisTokenPriceQueryZodSchema = z.object({
  ...paginationQueryZodSchema.shape,
  date: z
    .string()
    .refine((value) => dayjs(value).format('YYYY-MM-DD') === value, {
      message: 'Invalid date format',
    })
    .optional(),
});

export type GetGnosisTokenPriceQueryZodSchemaType = z.infer<
  typeof getGnosisTokenPriceQueryZodSchema
>;

export const getSafeWeekRewardsSnapshotQueryZodSchema = z.object({
  safe: addressZodSchema,
  week: weekIdZodSchemaWithDefault,
});

export type GetSafeWeekRewardsSnapshotQueryZodSchemaType = z.infer<
  typeof getSafeWeekRewardsSnapshotQueryZodSchema
>;

export const getRewardTransactionsQueryZodSchema = z.object({
  ...paginationQueryZodSchema.shape,
  address: addressZodSchema.optional(),
  week: weekIdZodSchema.optional(),
  'from-address': addressZodSchema.optional(),
  'to-address': addressZodSchema.optional(),
  'token': addressZodSchema.optional(),
});

export type GetRewardTransactionsQueryZodSchemaType = z.infer<
  typeof getRewardTransactionsQueryZodSchema
>;

export const getTokenBalanceSnapshotsQueryZodSchema = z.object({
  ...paginationQueryZodSchema.shape,
  address: addressZodSchema.optional(),
  week: weekIdZodSchema.optional(),
  block: z.coerce.number().optional(),
  token: addressZodSchema.optional(),
});
export type GetTokenBalanceSnapshotsQueryZodSchemaType = z.infer<
  typeof getTokenBalanceSnapshotsQueryZodSchema
>;

export const getTokenBalancesAtBlockQueryZodSchema = z.object({
  ...paginationQueryZodSchema.shape,
  block: z.coerce.number().optional(),
  address: addressZodSchema.optional(),
  token: addressZodSchema.optional(),
});
export type GetTokenBalancesAtBlockQueryZodSchemaType = z.infer<
  typeof getTokenBalancesAtBlockQueryZodSchema
>;

export const getMetriSafesMinimumBalancesQueryZodSchema = z.object({
  week: weekIdZodSchema,
});

export type GetMetriSafesMinimumBalancesQueryZodSchemaType = z.infer<
  typeof getMetriSafesMinimumBalancesQueryZodSchema
>;

/**
 * Schema for querying metri safes by specific addresses
 * Accepts addresses as comma-separated string or array
 * @example
 * {
 *   addresses: '0x123...,0x456...' or ['0x123...', '0x456...']
 *   week: '2025-W46'
 * }
 */
export const getMetriSafesMinimumBalancesByAddressesQueryZodSchema = z.object({
  addresses: z.preprocess(
    (val) => {
      if (Array.isArray(val)) {
        return val;
      }
      if (typeof val === 'string') {
        return val.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
      }
      return val;
    },
    z.array(addressZodSchema).min(1),
  ),
  week: weekIdZodSchema,
});

export type GetMetriSafesMinimumBalancesByAddressesQueryZodSchemaType = z.infer<
  typeof getMetriSafesMinimumBalancesByAddressesQueryZodSchema
>;

/**
 * Schema for querying metri safes week rewards data summary by addresses
 * Accepts addresses as comma-separated string or array
 * Week is optional and defaults to current week
 * @example
 * {
 *   addresses: '0x123...,0x456...' or ['0x123...', '0x456...']
 *   week: '2025-W46' (optional)
 * }
 */
export const getMetriSafesWeekRewardsDataSummaryByAddressesQueryZodSchema = z.object({
  addresses: z.preprocess(
    (val) => {
      if (Array.isArray(val)) {
        return val;
      }
      if (typeof val === 'string') {
        return val.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
      }
      return val;
    },
    z.array(addressZodSchema).min(1),
  ),
  week: weekIdZodSchemaWithDefault,
});

export type GetMetriSafesWeekRewardsDataSummaryByAddressesQueryZodSchemaType = z.infer<
  typeof getMetriSafesWeekRewardsDataSummaryByAddressesQueryZodSchema
>;

/**
 * Schema for POST body when querying metri safes week rewards data summary by addresses
 * Accepts addresses as an array
 * Week is optional and defaults to current week
 * @example
 * {
 *   addresses: ['0x123...', '0x456...']
 *   week: '2025-W46' (optional)
 * }
 */
export const postMetriSafesWeekRewardsDataSummaryByAddressesBodyZodSchema = z.object({
  addresses: z.array(addressZodSchema).min(1),
  week: weekIdZodSchemaWithDefault,
});

export type PostMetriSafesWeekRewardsDataSummaryByAddressesBodyZodSchemaType = z.infer<
  typeof postMetriSafesWeekRewardsDataSummaryByAddressesBodyZodSchema
>;

/**
 * Schema for POST body when querying metri safes to get their associated pay safes
 * Accepts addresses as an array
 * @example
 * {
 *   addresses: ['0x123...', '0x456...']
 * }
 */
export const postMetriSafesPaySafesBodyZodSchema = z.object({
  addresses: z.array(addressZodSchema).min(1),
});

export type PostMetriSafesPaySafesBodyZodSchemaType = z.infer<
  typeof postMetriSafesPaySafesBodyZodSchema
>;
