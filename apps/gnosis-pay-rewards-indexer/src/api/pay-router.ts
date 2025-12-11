import {
  GnosisPayTransactionFieldsType,
  gnoToken,
  payoutSafes,
  TokenFieldsType,
  toWeekId,
} from '@kpk/gnosis-pay-rewards-sdk';
import { payRewardsResponseZodSchema } from '@kpk/gnosis-pay-rewards-sdk/api';
import { CreateModelsReturnType } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import { createApiSuccessResponseBody, mongoosePaginateCustomLabels } from '@kpk/apps-sdk/api';
import { returnOakErrorResponse, returnOakSuccessResponse, withZodValidation } from '@kpk/apps-sdk/server';
import { Router } from '@oak/oak';
import { PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';
import { Logger } from 'winston';
import { dayjsUtc as dayjs } from '../lib/dayjs-utc.ts';
import type { RedisCache } from '../lib/redis-cache.ts';
import { BlockInfoProvider } from '../lib/block-info-provider.ts';
import {
  buildFilterQuery,
  findRewardTransactions,
  getGnosisPaySafeWeekRewardsSnapshotWithFallback,
  handleRewardsRequest,
} from './functions.ts';
import {
  GetPaginationQueryType,
  getPayDistributionsSummaryQueryZodSchema,
  GetPayDistributionsSummaryQueryZodSchemaType,
  GetPayTransactionsQueryType,
  getPayTransactionsQueryZodSchema,
  getSafeWeekRewardsSnapshotQueryZodSchema,
  paginationQueryZodSchema,
} from './router-zod.ts';
import { withCache } from './with-cache.ts';

export type CreatePayRouterParams = {
  mongooseModels: CreateModelsReturnType;
  logger?: Logger;
  client: PublicClient<Transport, typeof gnosis>;
  redisCache: RedisCache;
  blockInfoProvider: BlockInfoProvider;
};

export function createPayRouter({
  mongooseModels,
  client,
  logger,
  redisCache,
  blockInfoProvider,
}: CreatePayRouterParams) {
  const router = new Router();
  const { gnosisPayTransactionModel, rewardTransactionModel } = mongooseModels;

  // Cache durations in milliseconds
  const CACHE_DURATION = {
    OLDER_WEEK: 24 * 60 * 60 * 1000, // 24 hours
    CURRENT_WEEK: 30 * 60 * 1000, // 30 minutes
  };

  router.get('/rewards-summary', withZodValidation(getPayDistributionsSummaryQueryZodSchema), async (ctx) => {
    const queryParsed = ctx.state.validatedData as GetPayDistributionsSummaryQueryZodSchemaType;

    // Create cache key based on query parameters
    const cacheKey = `distributions-summary-${JSON.stringify(queryParsed)}`;

    // Define response type
    type DistributionsSummaryResponse = Awaited<ReturnType<typeof createApiSuccessResponseBody>> & {
      cache?: {
        hit: boolean;
        expiresAt: number;
      };
    };

    await withCache<DistributionsSummaryResponse>(
      redisCache,
      cacheKey,
      CACHE_DURATION.CURRENT_WEEK,
      ctx,
      async () => {
        const paginationResult = await findRewardTransactions(rewardTransactionModel, {
          'from-address': payoutSafes.gnosisPay,
          limit: 1000000,
          page: 1,
        });

        const items = paginationResult.docs;

        // Group by week and calculate total GNO per week
        const weeklyTotals = items.reduce((acc: Record<string, number>, item) => {
          const week = (item.week ?? 'unknown') as string;
          if (!acc[week]) {
            acc[week] = 0;
          }
          acc[week] += item.amount;
          return acc;
        }, {} as Record<string, number>);

        // Calculate total GNO paid out so far
        const totalGnoPaidOut = items.reduce((sum: number, item: { amount: number }) => sum + item.amount, 0);

        // Find the earliest and latest weeks (excluding 'unknown')
        const validWeeks = Object.keys(weeklyTotals).filter((week) => week !== 'unknown');
        let earliestWeek = '';
        let latestWeek = '';

        if (validWeeks.length > 0) {
          validWeeks.sort();
          earliestWeek = validWeeks[0];
          latestWeek = validWeeks[validWeeks.length - 1];
        }

        // Generate all weeks between earliest and latest (including missing ones)
        const allWeeks: Array<{ week: string; totalGno: number }> = [];

        if (earliestWeek && latestWeek) {
          let currentWeek = dayjs(earliestWeek);
          const endWeek = dayjs(latestWeek);

          while (currentWeek.unix() <= endWeek.unix()) {
            const weekStr = toWeekId(currentWeek.unix());
            allWeeks.push({
              week: weekStr,
              totalGno: weeklyTotals[weekStr] || 0,
            });
            currentWeek = currentWeek.add(1, 'week');
          }
        } else {
          // If no valid weeks, just use the existing data
          allWeeks.push(
            ...Object.entries(weeklyTotals).map(([week, totalGno]) => ({
              week,
              totalGno: totalGno as number,
            })),
          );
        }

        // Sort weeks (newest first), with 'unknown' weeks at the end
        const weeks = allWeeks.sort((a, b) => {
          if (a.week === 'unknown') return 1;
          if (b.week === 'unknown') return -1;
          return b.week.localeCompare(a.week);
        });

        const response = createApiSuccessResponseBody(
          { status: 200 },
          {
            weeks,
            totalGnoPaidOut,
            totalDistributions: items.length,
          },
        );
        return { ...response, _query: queryParsed };
      },
      {
        errorCode: 'DISTRIBUTIONS_SUMMARY_ERROR',
        errorMessage: 'Failed to fetch distributions summary',
      },
    );
  });

  router.get('/transactions', withZodValidation(getPayTransactionsQueryZodSchema), async (ctx) => {
    const { safe, limit, page, week, 'sort-by': sortBy, 'sort-order': sortOrder } = ctx.state
      .validatedData as GetPayTransactionsQueryType;

    const filterQuery = buildFilterQuery<GnosisPayTransactionFieldsType>({
      safe,
      week,
    });

    const paginationResult = await gnosisPayTransactionModel.paginate(filterQuery, {
      customLabels: mongoosePaginateCustomLabels,
      lean: true,
      limit,
      page,
      select: 'transactionHash amount week valueUSD token block type safe',
      populate: {
        path: 'token',
        select: 'address symbol decimals name',
      },
      sort: { [sortBy]: sortOrder === 'asc' ? 1 : -1 },
    });

    returnOakSuccessResponse(ctx, {
      data: paginationResult,
      meta: {
        status: 200,
      },
    });
  });

  router.get('/rewards', withZodValidation(getSafeWeekRewardsSnapshotQueryZodSchema), async (ctx) => {
    try {
      const data = await handleRewardsRequest({
        getSnapshot: () =>
          getGnosisPaySafeWeekRewardsSnapshotWithFallback(
            {
              mongooseModels,
              client,
              blockInfoProvider,
              redisCache,
            },
            ctx.state.validatedData,
          ),
        isMetriSafe: false,
        client,
        logger,
        mongooseModels,
        redisCache,
        fallbackToken: gnoToken as TokenFieldsType,
      });

      // Validate response against schema
      const response = {
        data,
        meta: {
          status: 200 as const,
        },
      };

      const safeParseResult = payRewardsResponseZodSchema.safeParse(response);

      if (!safeParseResult.success) {
        console.error('Failed to validate response against schema', safeParseResult.error);
        logger?.warn('Failed to validate response against schema', {
          error: safeParseResult.error,
        });
        throw new Error('Failed to validate response against schema');
      }

      returnOakSuccessResponse(ctx, safeParseResult.data);
    } catch (error) {
      logger?.error('Failed to fetch Pay rewards', error);

      returnOakErrorResponse(ctx, {
        errors: [
          {
            message: 'Failed to fetch Pay rewards',
            code: 'PAY_REWARDS_ERROR',
            details: error instanceof Error
              ? [
                {
                  message: error.message,
                  code: typeof error.cause === 'string' ? error.cause : error.name,
                },
              ]
              : undefined,
          },
        ],
        meta: {
          status: 500,
        },
      });
    }
  });

  router.get('/safes', withZodValidation(paginationQueryZodSchema), async (ctx) => {
    const queryParsed = ctx.state.validatedData as GetPaginationQueryType;

    const filterQuery = buildFilterQuery();

    const paginationResult = await mongooseModels.gnosisPaySafeModel.paginate(filterQuery, {
      customLabels: mongoosePaginateCustomLabels,
      lean: true,
      limit: queryParsed.limit,
      page: queryParsed.page,
      select: 'address isOG owners netVolumeUSD',
      sort: { address: 1 }, // Sort by address ascending
    });

    returnOakSuccessResponse(ctx, {
      data: paginationResult,
      meta: {
        status: 200,
      },
    });
  });

  return router;
}
