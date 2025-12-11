import {
  BlockDocumentFieldsType,
  GnosisPayTransactionFieldsType,
  IndexerStateType,
  TokenBalanceSnapshotFieldsType,
  TokenPriceSnapshotFieldsType,
  toWeekId,
} from '@kpk/gnosis-pay-rewards-sdk';
import { statusResponseZodSchema } from '@kpk/gnosis-pay-rewards-sdk/api';
import { CreateModelsReturnType } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import {
  createApiErrorResponseBody,
  createApiSuccessResponseBody,
  mongoosePaginateCustomLabels,
} from '@kpk/apps-sdk/api';
import { returnOakErrorResponse, returnOakSuccessResponse, withZodValidation } from '@kpk/apps-sdk/server';
import { Router } from '@oak/oak';
import { FilterQuery } from 'mongoose';
import 'mongoose-paginate-v2'; // loads the mongoose .paginate method types on the models
import { Address, PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';
import { Logger } from 'winston';
// Core GP
import { dayjsUtc as dayjs } from '../lib/dayjs-utc.ts';
import type { RedisCache } from '../lib/redis-cache.ts';
import { BlockInfoProvider } from '../lib/block-info-provider.ts';
import {
  buildFilterQuery,
  findRewardTransactions,
  getGnosisPaySafeWeekRewardsSnapshotWithFallback,
} from './functions.ts';
import { createMetriRouter } from './metri-router.ts';
import { createPayRouter } from './pay-router.ts';
import {
  getAllWeeksSnapshotsQueryZodSchema,
  GetAllWeeksSnapshotsQueryZodSchemaType,
  getGnosisPaySafeWeekRewardsSummaryQueryZodSchema,
  GetGnosisPaySafeWeekRewardsSummaryQueryZodSchemaType,
  getGnosisTokenPriceQueryZodSchema,
  GetGnosisTokenPriceQueryZodSchemaType,
  GetPaginationQueryType,
  getRewardTransactionsQueryZodSchema,
  getTokenBalancesAtBlockQueryZodSchema,
  GetTokenBalancesAtBlockQueryZodSchemaType,
  getTokenBalanceSnapshotsQueryZodSchema,
  GetTokenBalanceSnapshotsQueryZodSchemaType,
  paginationQueryZodSchema,
} from './router-zod.ts';
import { withCache } from './with-cache.ts';
import { getTokenBalanceSnapshots } from './get-token-balance-snapshots.ts';

export type CreateRouterParams = {
  mongooseModels: CreateModelsReturnType;
  logger?: Logger;
  client: PublicClient<Transport, typeof gnosis>;
  getIndexerStates: () => Promise<IndexerStateType[]>;
  redisCache: RedisCache;
  blockInfoProvider: BlockInfoProvider;
};

export function createRouter({
  mongooseModels,
  getIndexerStates,
  client,
  logger,
  redisCache,
  blockInfoProvider,
}: CreateRouterParams) {
  const router = new Router();

  // Create metri router and mount it at /metri
  const metriRouter = createMetriRouter({
    mongooseModels,
    client,
    logger,
    redisCache,
    blockInfoProvider,
  });
  router.use('/metri', metriRouter.routes(), metriRouter.allowedMethods());

  // Create pay router and mount it at /pay
  const payRouter = createPayRouter({
    mongooseModels,
    client,
    logger,
    redisCache,
    blockInfoProvider,
  });
  router.use('/pay', payRouter.routes(), payRouter.allowedMethods());
  // Create a BlockInfoProvider instance for API endpoints
  const {
    safeWeekRewardsSnapshotModel,
    rewardTransactionModel,
    weekMetricsSnapshotModel,
    tokenPriceModel,
    blockModel,
    processedBlockModel,
  } = mongooseModels;

  // Cache is now passed as parameter

  // Cache durations in milliseconds
  const CACHE_DURATION = {
    OLDER_WEEK: 24 * 60 * 60 * 1000, // 24 hours
    CURRENT_WEEK: 30 * 60 * 1000, // 30 minutes
  };

  router.get('/', (ctx) => {
    returnOakSuccessResponse(ctx, {
      data: {},
      meta: {
        status: 200,
      },
    });
  });

  router.get('/status', async (ctx) => {
    const data = await getIndexerStates();

    // Validate response against schema
    const response = {
      data,
      meta: {
        status: 200 as const,
      },
    };
    const validatedResponse = statusResponseZodSchema.parse(response);

    returnOakSuccessResponse(ctx, validatedResponse);
  });

  router.get('/info', (ctx) => {
    const data = {
      blockInfoProvider: {
        cacheSize: blockInfoProvider.getCacheSize(),
      },
    };
    returnOakSuccessResponse(ctx, {
      data,
      meta: {
        status: 200,
      },
    });
  });

  router.get(
    '/week-snapshots',
    withZodValidation(getAllWeeksSnapshotsQueryZodSchema),
    async (ctx) => {
      const { week } = ctx.state
        .validatedData as GetAllWeeksSnapshotsQueryZodSchemaType;
      const cacheKey = `week-snapshots-${week}`;

      // Define response type
      type WeekSnapshotResponse =
        & Awaited<ReturnType<typeof createApiSuccessResponseBody>>
        & {
          cache?: {
            hit: boolean;
            expiresAt: number;
          };
        };

      // Determine if weekId is current week or older
      const currentWeekId = toWeekId(dayjs.utc().unix());
      const isCurrentWeek = week === currentWeekId;
      const cacheDuration = isCurrentWeek ? CACHE_DURATION.CURRENT_WEEK : CACHE_DURATION.OLDER_WEEK;

      await withCache<WeekSnapshotResponse>(
        redisCache,
        cacheKey,
        cacheDuration,
        ctx,
        async () => {
          const weekSafeSnapshot = await safeWeekRewardsSnapshotModel
            .find({ week })
            .select(
              'safe week netVolumeUSD estimatedReward earnedReward transactions tokenBalanceSnapshots',
            ) // Only select needed fields
            .populate<{ transactions: GnosisPayTransactionFieldsType[] }>(
              'transactions',
              {
                valueUSD: 1,
                token: 1,
                amount: 1,
                transactionHash: 1,
                type: 1,
              },
            )
            .populate<
              { tokenBalanceSnapshots: TokenBalanceSnapshotFieldsType[] }
            >('tokenBalanceSnapshots', {
              balance: 1,
            })
            .populate<{ safe: { isOG: boolean; _id: Address } }>('safe', {
              isOG: 1,
            })
            .lean();

          const response = createApiSuccessResponseBody(
            { status: 200 },
            weekSafeSnapshot,
          );
          return response;
        },
        {
          errorCode: 'BOT_INFO_ERROR',
          errorMessage: 'Failed to fetch week snapshots',
        },
      );
    },
  );

  router.get('/weeks', async (ctx) => {
    const cacheKey = 'weeks-list';
    const cacheDuration = 5 * 60 * 1000;

    await withCache(
      redisCache,
      cacheKey,
      cacheDuration,
      ctx,
      async () => {
        const queryResult = await weekMetricsSnapshotModel
          .find()
          .select('week')
          .sort({ week: -1 }) // Most recent weeks first
          .lean();

        const weeksArrayWithIds = queryResult.map((item) => ({
          week: item.week,
          id: item.week,
        }));

        return createApiSuccessResponseBody({
          status: 200,
        }, weeksArrayWithIds);
      },
      {
        errorCode: 'WEEKS_LIST_ERROR',
        errorMessage: 'Failed to fetch weeks list',
      },
    );
  });

  router.get(
    '/summary',
    withZodValidation(getGnosisPaySafeWeekRewardsSummaryQueryZodSchema),
    async (ctx) => {
      try {
        const queryParsed = ctx.state
          .validatedData as GetGnosisPaySafeWeekRewardsSummaryQueryZodSchemaType;
        const safeAddress = queryParsed.safe.toLowerCase() as Address;
        const week = queryParsed.week || toWeekId(dayjs.utc().unix());
        // Try to find the week reward document
        const weekRewardSnapshotDocument = await getGnosisPaySafeWeekRewardsSnapshotWithFallback(
          {
            mongooseModels,
            client,
            blockInfoProvider,
            redisCache,
          },
          {
            safe: safeAddress,
            week,
          },
        );

        if (weekRewardSnapshotDocument === null) {
          return createApiErrorResponseBody(
            { status: 404 },
            [{
              message: 'No cashbacks found for this address and week',
              code: 'NO_CASHBACKS_FOUND',
            }],
          );
        }

        const paginationResult = await findRewardTransactions(
          rewardTransactionModel,
          {
            address: safeAddress,
            limit: 1000000,
            page: 1,
          },
        );
        const distributionDocuments = paginationResult.docs;
        const earnedRewards = distributionDocuments.reduce(
          (acc: number, dist) => dist.amount + acc,
          0,
        );

        const weeklyRewardSnapshotDocuments = await safeWeekRewardsSnapshotModel
          .find({
            safe: safeAddress,
          })
          .sort({ week: -1 })
          .lean();

        const totalEstimatedRewardsUSD = weeklyRewardSnapshotDocuments.reduce(
          (acc, doc) => {
            return acc +
              doc.estimatedRewards.reduce(
                (acc, reward) => acc + reward.valueUSD,
                0,
              );
          },
          0,
        );
        // pending rewards are the rewards that are pending to be claimed
        const pendingRewards = totalEstimatedRewardsUSD - earnedRewards;
        // get the safe info from the week reward snapshot document
        const { safe } = weekRewardSnapshotDocument.toJSON();

        const summary = {
          week,
          safe,
          pendingRewards,
          earnedRewards,
        };

        returnOakSuccessResponse(ctx, {
          data: summary,
          meta: {
            status: 200,
          },
        });
      } catch (error) {
        returnOakErrorResponse(
          ctx,
          createApiErrorResponseBody(
            { status: 500 },
            [{
              message: 'Failed to fetch bot info',
              code: 'BOT_INFO_ERROR',
              details: error instanceof Error ? [error] : undefined,
            }],
          ),
        );
      }
    },
  );

  router.get(
    '/distributions',
    withZodValidation(getRewardTransactionsQueryZodSchema),
    async (ctx) => {
      try {
        const items = await findRewardTransactions(rewardTransactionModel, ctx.state.validatedData);
        const itemsCount = items.length;

        returnOakSuccessResponse(ctx, {
          data: {
            itemsCount,
            items,
          },
          meta: {
            status: 200,
          },
        });
      } catch (error) {
        returnOakErrorResponse(
          ctx,
          createApiErrorResponseBody(
            { status: 500 },
            [{
              message: 'Failed to fetch distributions',
              code: 'DISTRIBUTIONS_ERROR',
              details: error instanceof Error ? [error] : undefined,
            }],
          ),
        );
      }
    },
  );

  router.get(
    '/token-prices',
    withZodValidation(getGnosisTokenPriceQueryZodSchema),
    async (ctx) => {
      const queryParsed = ctx.state
        .validatedData as GetGnosisTokenPriceQueryZodSchemaType;

      const filterQuery: FilterQuery<TokenPriceSnapshotFieldsType> = {};

      if (queryParsed.date) {
        const dateStart = dayjs(queryParsed.date).startOf('day').unix();
        const dateEnd = dayjs(queryParsed.date).endOf('day').unix();

        filterQuery.blockTimestamp = {
          $gte: dateStart,
          $lte: dateEnd,
        };
      }

      const paginationResult = await tokenPriceModel.paginate(filterQuery, {
        customLabels: mongoosePaginateCustomLabels,
        lean: true,
        limit: queryParsed.limit,
        page: queryParsed.page,
        populate: {
          path: 'token',
          select: 'address decimals symbol name',
        },
        projection: {
          token: 1,
          price: 1,
          block: 1,
          _id: 0,
        },
      });

      returnOakSuccessResponse(ctx, {
        data: paginationResult,
        meta: {
          status: 200,
        },
      });
    },
  );

  router.get(
    '/blocks',
    withZodValidation(paginationQueryZodSchema),
    async (ctx) => {
      const queryParsed = ctx.state.validatedData as GetPaginationQueryType;

      const filterQuery = buildFilterQuery<BlockDocumentFieldsType>();

      const paginationResult = await blockModel.paginate(filterQuery, {
        customLabels: mongoosePaginateCustomLabels,
        lean: true,
        limit: queryParsed.limit,
        page: queryParsed.page,
        sort: { number: -1 }, // Sort by block number descending (newest first)
      });

      returnOakSuccessResponse(ctx, {
        data: paginationResult,
        meta: {
          status: 200,
        },
      });
    },
  );

  router.get(
    '/processed-blocks',
    withZodValidation(paginationQueryZodSchema),
    async (ctx) => {
      const queryParsed = ctx.state.validatedData as GetPaginationQueryType;

      const filterQuery = buildFilterQuery<BlockDocumentFieldsType>();

      const paginationResult = await processedBlockModel.paginate(filterQuery, {
        customLabels: mongoosePaginateCustomLabels,
        lean: true,
        limit: queryParsed.limit,
        page: queryParsed.page,
        sort: { number: -1 }, // Sort by block number descending (newest first)
      });

      returnOakSuccessResponse(ctx, {
        data: paginationResult,
        meta: {
          status: 200,
        },
      });
    },
  );

  router.get('/tokens', async (ctx) => {
    const tokens = await mongooseModels.tokenModel.find({});
    returnOakSuccessResponse(ctx, {
      data: tokens,
      meta: {
        status: 200,
      },
    });
  });

  router.get(
    '/token-balance-snapshots',
    withZodValidation(getTokenBalanceSnapshotsQueryZodSchema),
    async (ctx) => {
      try {
        const queryParsed = ctx.state
          .validatedData as GetTokenBalanceSnapshotsQueryZodSchemaType;

        const snapshots = await getTokenBalanceSnapshots(
          {
            mongooseModels,
            client,
            blockInfoProvider,
            logger,
            redisCache,
          },
          queryParsed,
        );

        returnOakSuccessResponse(ctx, {
          data: snapshots,
          meta: {
            status: 200,
          },
        });
      } catch (error) {
        // Handle invalid address error specifically
        if (error instanceof Error && error.message === 'Address is not a Gnosis Pay Safe or Metri Safe') {
          returnOakErrorResponse(ctx, {
            errors: [{
              message: error.message,
              code: 'ADDRESS_NOT_VALID',
            }],
            meta: {
              status: 400,
            },
          });
          return;
        }

        returnOakErrorResponse(
          ctx,
          createApiErrorResponseBody(
            { status: 500 },
            [{
              message: 'Failed to fetch token balance snapshots',
              code: 'TOKEN_BALANCE_SNAPSHOTS_ERROR',
              details: error instanceof Error ? [error] : undefined,
            }],
          ),
        );
      }
    },
  );

  router.get(
    '/token-balances-at-block',
    withZodValidation(getTokenBalancesAtBlockQueryZodSchema),
    async (ctx) => {
      try {
        const queryParsed = ctx.state
          .validatedData as GetTokenBalancesAtBlockQueryZodSchemaType;

        const snapshots = await getTokenBalanceSnapshots(
          {
            mongooseModels,
            client,
            blockInfoProvider,
            logger,
            redisCache,
          },
          queryParsed,
        );

        returnOakSuccessResponse(ctx, {
          data: snapshots,
          meta: {
            status: 200,
          },
        });
      } catch (error) {
        // Handle invalid address error specifically
        if (error instanceof Error && error.message === 'Address is not a Gnosis Pay Safe or Metri Safe') {
          returnOakErrorResponse(ctx, {
            errors: [{
              message: error.message,
              code: 'ADDRESS_NOT_VALID',
            }],
            meta: {
              status: 400,
            },
          });
          return;
        }

        returnOakErrorResponse(
          ctx,
          createApiErrorResponseBody(
            { status: 500 },
            [{
              message: 'Failed to fetch token balances at block',
              code: 'TOKEN_BALANCES_AT_BLOCK_ERROR',
              details: error instanceof Error ? [error] : undefined,
            }],
          ),
        );
      }
    },
  );

  // Handle all other routes
  router.all('/(.*)', (ctx) => {
    returnOakErrorResponse(ctx, {
      errors: [{
        message: 'Not found',
        code: 'NOT_FOUND',
      }],
      meta: {
        status: 404,
      },
    });
  });

  return router;
}
