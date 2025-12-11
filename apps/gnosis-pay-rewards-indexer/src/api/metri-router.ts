import { gCrcToken, gnoToken, TokenFieldsType, toWeekId } from '@kpk/gnosis-pay-rewards-sdk';
import {
  metriRewardsResponseZodSchema,
  metriWeekBalancesResponseZodSchema,
  metriWeekRewardsDataSummaryResponseZodSchema,
} from '@kpk/gnosis-pay-rewards-sdk/api';
import { CreateModelsReturnType } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import { createApiSuccessResponseBody, mongoosePaginateCustomLabels } from '@kpk/apps-sdk/api';
import { returnOakErrorResponse, returnOakSuccessResponse, withZodValidation } from '@kpk/apps-sdk/server';
import { Router } from '@oak/oak';
import { Address, isAddressEqual, PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';
import { Logger } from 'winston';
import { dayjsUtc as dayjs } from '../lib/dayjs-utc.ts';
import type { RedisCache } from '../lib/redis-cache.ts';
import { BlockInfoProvider } from '../lib/block-info-provider.ts';
import {
  buildFilterQuery,
  getMetriSafeWeekRewardsSnapshotWithFallback,
  handleRewardsRequest,
  toMinAndMaxTokenBalancesMap,
} from './functions.ts';
import { findLowestMetriWalletGnoBalance, TokenBalanceSnapshotWithTokenFieldsType } from './min-balance-functions.ts';
import {
  getMetriSafesMinimumBalancesByAddressesQueryZodSchema,
  GetMetriSafesMinimumBalancesByAddressesQueryZodSchemaType,
  getMetriSafesMinimumBalancesQueryZodSchema,
  GetMetriSafesMinimumBalancesQueryZodSchemaType,
  GetPaginationQueryType,
  getSafeWeekRewardsSnapshotQueryZodSchema,
  paginationQueryZodSchema,
  postMetriSafesPaySafesBodyZodSchema,
  PostMetriSafesPaySafesBodyZodSchemaType,
  postMetriSafesWeekRewardsDataSummaryByAddressesBodyZodSchema,
  PostMetriSafesWeekRewardsDataSummaryByAddressesBodyZodSchemaType,
} from './router-zod.ts';
import { withCache } from './with-cache.ts';
import { getMetriSafesWeekRewardsDataSummary } from './week-rewards-data-summary-handler.ts';
import { getGnosisPaySafeFromMetriSafe, getGnosisPaySafesFromMetriSafes } from '../lib/metri/checkers.ts';
import { withRedisCache } from '../lib/with-redis-cache.ts';

export type CreateMetriRouterParams = {
  mongooseModels: CreateModelsReturnType;
  logger?: Logger;
  client: PublicClient<Transport, typeof gnosis>;
  redisCache: RedisCache;
  blockInfoProvider: BlockInfoProvider;
};

export function createMetriRouter({
  mongooseModels,
  client,
  logger,
  redisCache,
  blockInfoProvider,
}: CreateMetriRouterParams) {
  const router = new Router();
  const { safeWeekRewardsSnapshotModel } = mongooseModels;

  // Cache durations in milliseconds
  const CACHE_DURATION = {
    OLDER_WEEK: 24 * 60 * 60 * 1000, // 24 hours
    CURRENT_WEEK: 30 * 60 * 1000, // 30 minutes
  };

  // Create cached version of getGnosisPaySafeFromMetriSafe
  const getGnosisPaySafeFromMetriSafeWithCache = withRedisCache(
    getGnosisPaySafeFromMetriSafe,
    {
      redisCache,
      cacheKeyGenerator: (metriSafeAddress: Address) => `gnosis-pay-safe-from-metri:${metriSafeAddress.toLowerCase()}`,
      cacheDuration: CACHE_DURATION.OLDER_WEEK, // 24 hours
    },
  );

  router.get('/rewards', withZodValidation(getSafeWeekRewardsSnapshotQueryZodSchema), async (ctx) => {
    try {
      const data = await handleRewardsRequest({
        getSnapshot: () =>
          getMetriSafeWeekRewardsSnapshotWithFallback(
            {
              mongooseModels,
              client,
              blockInfoProvider,
              redisCache,
            },
            ctx.state.validatedData,
          ),
        isMetriSafe: true,
        client,
        logger,
        mongooseModels,
        redisCache,
        fallbackToken: gCrcToken as TokenFieldsType,
      });

      // Validate response against schema
      const response = {
        data,
        meta: {
          status: 200 as const,
        },
      };
      const safeParseResult = metriRewardsResponseZodSchema.safeParse(response);

      if (!safeParseResult.success) {
        console.error('Failed to validate response against schema', safeParseResult.error);
        logger?.error('Failed to validate metri rewards response against schema', {
          error: safeParseResult.error,
          response,
        });
        throw new Error('Failed to validate metri rewards response against schema');
      }

      returnOakSuccessResponse(ctx, safeParseResult.data);
    } catch (error) {
      logger?.error('Failed to fetch Metri rewards', error);

      returnOakErrorResponse(ctx, {
        errors: [
          {
            message: 'Failed to fetch Metri rewards',
            code: 'METRI_REWARDS_ERROR',
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

  router.get('/week-balances', withZodValidation(getMetriSafesMinimumBalancesQueryZodSchema), async (ctx) => {
    try {
      const { week } = ctx.state.validatedData as GetMetriSafesMinimumBalancesQueryZodSchemaType;
      const cacheKey = `metri-week-balances-${week}`;

      // Determine if weekId is current week or older
      const currentWeekId = toWeekId(dayjs.utc().unix());
      const isCurrentWeek = week === currentWeekId;
      const cacheDuration = isCurrentWeek ? CACHE_DURATION.CURRENT_WEEK : CACHE_DURATION.OLDER_WEEK;

      await withCache(
        redisCache,
        cacheKey,
        cacheDuration,
        ctx,
        async () => {
          // Get all metri safes with isOG and populated gnosisPaySafe
          const metriSafes = await mongooseModels.metriSafeModel
            .find({})
            .select('address isOG gnosisPaySafe')
            .populate<{
              gnosisPaySafe: {
                _id: Address;
                address: Address;
                isOG: boolean;
                owners: Address[];
              } | null;
            }>({
              path: 'gnosisPaySafe',
              select: 'address isOG owners',
            })
            .lean();

          // For each metri safe, get their week snapshot and calculate minimum balances
          const results = await Promise.all(
            metriSafes.map(async (metriSafe) => {
              const safeAddress = metriSafe.address as Address;
              const isOG = metriSafe.isOG ?? false;
              // gnosisPaySafe is already populated with the correct structure from the query above
              const gnosisPaySafe = metriSafe.gnosisPaySafe || null;

              const documentId = safeWeekRewardsSnapshotModel.createDocumentId(week, safeAddress);

              // Get the week snapshot for this metri safe
              const snapshot = await safeWeekRewardsSnapshotModel
                .findById(documentId)
                .populate<{ tokenBalanceSnapshots: TokenBalanceSnapshotWithTokenFieldsType[] }>({
                  path: 'tokenBalanceSnapshots',
                  select: 'block balance week token',
                  populate: {
                    path: 'token',
                    select: 'address decimals symbol name',
                  },
                })
                .lean();

              if (!snapshot) {
                return {
                  safe: safeAddress,
                  isOG,
                  gnosisPaySafe,
                  minTokenBalance: {} as Record<Address, number>,
                };
              }

              // Calculate minimum balances
              let populatedSnapshots =
                ((snapshot.tokenBalanceSnapshots as unknown) as TokenBalanceSnapshotWithTokenFieldsType[]) || [];

              // Find lowest GNO balance considering movement from Pay safe to Metri safe
              let lowestGnoBalance = 0;
              if (gnosisPaySafe) {
                const gnosisPaySafeAddress = gnosisPaySafe.address as Address;
                lowestGnoBalance = await findLowestMetriWalletGnoBalance({
                  metriSafeAddress: safeAddress,
                  gnosisPaySafeAddress,
                  week,
                  tokenBalanceSnapshotModel: mongooseModels.tokenBalanceSnapshotModel,
                });

                // Remove GNO snapshots since we'll use the calculated minimum
                const gnoTokenAddress = gnoToken.address.toLowerCase() as Address;
                populatedSnapshots = populatedSnapshots.filter((snapshot) => {
                  const tokenAddress = (snapshot.token as TokenFieldsType)?.address?.toLowerCase();
                  return tokenAddress !== gnoTokenAddress;
                });
              }

              const { minTokenBalance } = toMinAndMaxTokenBalancesMap(populatedSnapshots);

              // Add the lowest GNO balance (always add it, even if 0)
              if (gnosisPaySafe) {
                const gnoTokenAddress = gnoToken.address.toLowerCase() as Address;
                minTokenBalance[gnoTokenAddress] = lowestGnoBalance;
              }

              return {
                safe: safeAddress,
                isOG,
                gnosisPaySafe,
                minTokenBalance,
              };
            }),
          );

          const response = createApiSuccessResponseBody({ status: 200 }, results);

          // Validate response against schema
          const validatedResponse = metriWeekBalancesResponseZodSchema.parse(response);

          return validatedResponse;
        },
        {
          errorCode: 'METRI_MINIMUM_BALANCES_ERROR',
          errorMessage: 'Failed to fetch Metri safes minimum balances',
        },
      );
    } catch (error) {
      logger?.error('Failed to fetch Metri safes minimum balances', error);

      returnOakErrorResponse(ctx, {
        errors: [
          {
            message: 'Failed to fetch Metri safes minimum balances',
            code: 'METRI_MINIMUM_BALANCES_ERROR',
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

  router.get(
    '/week-balances/by-addresses',
    withZodValidation(getMetriSafesMinimumBalancesByAddressesQueryZodSchema),
    async (ctx) => {
      try {
        const { week, addresses } = ctx.state
          .validatedData as GetMetriSafesMinimumBalancesByAddressesQueryZodSchemaType;

        // Normalize addresses to lowercase for querying (addresses are stored in lowercase)
        const normalizedAddresses = addresses.map((addr) => addr.toLowerCase() as Address);

        // Create cache key from normalized addresses and week
        const addressesKey = [...normalizedAddresses].sort().join(',');
        const cacheKey = `metri-week-balances-by-addresses-${addressesKey}-${week}`;

        // Determine if weekId is current week or older
        const currentWeekId = toWeekId(dayjs.utc().unix());
        const isCurrentWeek = week === currentWeekId;
        const cacheDuration = isCurrentWeek ? CACHE_DURATION.CURRENT_WEEK : CACHE_DURATION.OLDER_WEEK;

        await withCache(
          redisCache,
          cacheKey,
          cacheDuration,
          ctx,
          async () => {
            // Get metri safes for the specified addresses with isOG and populated gnosisPaySafe
            const metriSafes = await mongooseModels.metriSafeModel
              .find({
                address: { $in: normalizedAddresses },
              })
              .select('address isOG gnosisPaySafe')
              .populate<{
                gnosisPaySafe: {
                  _id: Address;
                  address: Address;
                  isOG: boolean;
                  owners: Address[];
                } | null;
              }>({
                path: 'gnosisPaySafe',
                select: 'address isOG owners',
              })
              .lean();

            // Create a map of found addresses for quick lookup
            const foundAddressesMap = new Map(metriSafes.map((safe) => [safe.address.toLowerCase() as Address, safe]));

            // For each requested address, get their week snapshot and calculate minimum balances
            const results = await Promise.all(
              normalizedAddresses.map(async (normalizedAddress) => {
                const metriSafe = foundAddressesMap.get(normalizedAddress);

                const isOG = metriSafe?.isOG ?? false;
                const gnosisPaySafe = metriSafe?.gnosisPaySafe || null;

                const documentId = safeWeekRewardsSnapshotModel.createDocumentId(week, normalizedAddress);

                // Get the week snapshot for this metri safe
                const snapshot = await safeWeekRewardsSnapshotModel
                  .findById(documentId)
                  .populate<{ tokenBalanceSnapshots: TokenBalanceSnapshotWithTokenFieldsType[] }>({
                    path: 'tokenBalanceSnapshots',
                    select: 'block balance week token',
                    populate: {
                      path: 'token',
                      select: 'address decimals symbol name',
                    },
                  })
                  .lean();

                if (!snapshot) {
                  return {
                    safe: normalizedAddress,
                    isOG,
                    gnosisPaySafe,
                    minTokenBalance: {} as Record<Address, number>,
                  };
                }

                // Calculate minimum balances
                let populatedSnapshots =
                  ((snapshot.tokenBalanceSnapshots as unknown) as TokenBalanceSnapshotWithTokenFieldsType[]) || [];

                // Find lowest GNO balance considering movement from Pay safe to Metri safe
                let lowestGnoBalance = 0;
                if (gnosisPaySafe) {
                  const gnosisPaySafeAddress = gnosisPaySafe.address as Address;
                  lowestGnoBalance = await findLowestMetriWalletGnoBalance({
                    metriSafeAddress: normalizedAddress,
                    gnosisPaySafeAddress,
                    week,
                    tokenBalanceSnapshotModel: mongooseModels.tokenBalanceSnapshotModel,
                  });

                  // Remove GNO snapshots since we'll use the calculated minimum
                  const gnoTokenAddress = gnoToken.address.toLowerCase() as Address;
                  populatedSnapshots = populatedSnapshots.filter((snapshot) => {
                    return isAddressEqual(snapshot.token.address, gnoTokenAddress) === false;
                  });
                }

                const { minTokenBalance, maxTokenBalance } = toMinAndMaxTokenBalancesMap(populatedSnapshots);

                // Add the lowest GNO balance (always add it, even if 0)
                if (gnosisPaySafe) {
                  const gnoTokenAddress = gnoToken.address.toLowerCase() as Address;
                  minTokenBalance[gnoTokenAddress] = lowestGnoBalance;
                }

                return {
                  safe: normalizedAddress,
                  isOG,
                  gnosisPaySafe,
                  minTokenBalance,
                  maxTokenBalance,
                };
              }),
            );

            const response = createApiSuccessResponseBody({ status: 200 }, results);

            // Validate response against schema
            const validatedResponse = metriWeekBalancesResponseZodSchema.parse(response);

            return validatedResponse;
          },
          {
            errorCode: 'METRI_MINIMUM_BALANCES_BY_ADDRESSES_ERROR',
            errorMessage: 'Failed to fetch Metri safes minimum balances by addresses',
          },
        );
      } catch (error) {
        logger?.error('Failed to fetch Metri safes minimum balances by addresses', error);

        returnOakErrorResponse(ctx, {
          errors: [
            {
              message: 'Failed to fetch Metri safes minimum balances by addresses',
              code: 'METRI_MINIMUM_BALANCES_BY_ADDRESSES_ERROR',
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
    },
  );

  router.post(
    '/week-rewards-data-summary',
    withZodValidation(postMetriSafesWeekRewardsDataSummaryByAddressesBodyZodSchema),
    async (ctx) => {
      try {
        const { week, addresses } = ctx.state
          .validatedData as PostMetriSafesWeekRewardsDataSummaryByAddressesBodyZodSchemaType;

        // Normalize addresses to lowercase for querying (addresses are stored in lowercase)
        const normalizedMetriAddresses = addresses.map((addr: Address) => addr.toLowerCase() as Address);

        // Create cache key from sorted normalized addresses and week
        const addressesKey = [...normalizedMetriAddresses].sort().join(',');
        const cacheKey = `by-addresses/metri-week-rewards-data-summary-${addressesKey}-${week}`;

        // Determine if weekId is current week or older
        const currentWeekId = toWeekId(dayjs.utc().unix());
        const isCurrentWeek = week === currentWeekId;
        const cacheDuration = isCurrentWeek ? CACHE_DURATION.CURRENT_WEEK : CACHE_DURATION.OLDER_WEEK;

        await withCache(
          redisCache,
          cacheKey,
          cacheDuration,
          ctx,
          async () => {
            // First, filter addresses to only include those with gnosis pay safe
            // Check each address using getGnosisPaySafeFromMetriSafeWithCache
            const gnosisPaySafeChecks = await Promise.allSettled(
              normalizedMetriAddresses.map((metriAddress) => getGnosisPaySafeFromMetriSafeWithCache(metriAddress)),
            );

            // Collect addresses that have a gnosis pay safe (non-null result)
            const metriAddressesWithGnosisPaySafe = new Set<Address>();
            gnosisPaySafeChecks.forEach((result, index) => {
              if (result.status === 'fulfilled' && result.value !== null) {
                metriAddressesWithGnosisPaySafe.add(normalizedMetriAddresses[index]);
              } else if (result.status === 'fulfilled' && result.value === null) {
                // Address doesn't have a gnosis pay safe - exclude it
                logger?.debug('Metri safe does not have a gnosis pay safe, excluding from summary', {
                  address: normalizedMetriAddresses[index],
                });
              } else if (result.status === 'rejected') {
                logger?.error('Failed to get Gnosis Pay safe from Metri safe', {
                  address: normalizedMetriAddresses[index],
                  error: result.reason,
                });
              }
            });

            // If no addresses have gnosis pay safe, return empty array early
            if (metriAddressesWithGnosisPaySafe.size === 0) {
              const response = createApiSuccessResponseBody({ status: 200 }, []);
              const safeParseResult = metriWeekRewardsDataSummaryResponseZodSchema.safeParse(response);
              if (!safeParseResult.success) {
                throw new Error('Failed to validate empty response against schema');
              }
              return safeParseResult.data;
            }

            const metriAddressesWithSnapshots = new Set<Address>();

            // Ensure week snapshot documents and token balance snapshots exist for each address
            // This ensures data is available before querying for week rewards data summary
            // Use Promise.allSettled to parallelize all calls and handle errors individually
            const snapshotResults = await Promise.allSettled(
              Array.from(metriAddressesWithGnosisPaySafe).map((metriAddress) =>
                getMetriSafeWeekRewardsSnapshotWithFallback(
                  {
                    mongooseModels,
                    client,
                    blockInfoProvider,
                    redisCache,
                  },
                  {
                    safe: metriAddress,
                    week,
                  },
                )
              ),
            );

            // Process results and collect addresses with snapshots
            // Since we've already filtered by checking getGnosisPaySafeFromMetriSafeWithCache,
            // we can include all successful snapshots
            const filteredAddresses = Array.from(metriAddressesWithGnosisPaySafe);
            snapshotResults.forEach((result, index) => {
              if (result.status === 'fulfilled') {
                // Add metri address since we've already verified it has a gnosis pay safe
                metriAddressesWithSnapshots.add(filteredAddresses[index]);
              } else {
                logger?.error('Failed to get Metri safe week rewards snapshot', {
                  address: filteredAddresses[index],
                  error: result.reason,
                });
              }
            });

            // debugger;

            const metriSafesWeekRewardsDataSummary = await getMetriSafesWeekRewardsDataSummary({
              logger,
              mongooseModels,
              blockInfoProvider,
              client,
            }, {
              addresses: Array.from(metriAddressesWithSnapshots), // Filter out anything that didn't have snapshots
              week,
            });

            const response = createApiSuccessResponseBody({ status: 200 }, metriSafesWeekRewardsDataSummary);

            const safeParseResult = metriWeekRewardsDataSummaryResponseZodSchema.safeParse(response);

            // Validate response against schema
            if (!safeParseResult.success) {
              console.error('Failed to validate response against schema', safeParseResult.error);
              logger?.error(
                'Failed to validate Metri safes week rewards data summary by addresses response against schema',
                {
                  error: safeParseResult.error,
                  response,
                },
              );
              throw new Error(
                'Failed to validate Metri safes week rewards data summary by addresses response against schema',
              );
            }

            return safeParseResult.data;
          },
          {
            errorCode: 'METRI_WEEK_REWARDS_DATA_SUMMARY_ERROR',
            errorMessage: 'Failed to fetch Metri safes week rewards data summary by addresses',
          },
        );
      } catch (error) {
        logger?.error('Failed to fetch Metri safes week rewards data summary by addresses', error);

        returnOakErrorResponse(ctx, {
          errors: [
            {
              message: 'Failed to fetch Metri safes week rewards data summary by addresses',
              code: 'METRI_WEEK_REWARDS_DATA_SUMMARY_ERROR',
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
    },
  );

  router.get('/safes', withZodValidation(paginationQueryZodSchema), async (ctx) => {
    const queryParsed = ctx.state.validatedData as GetPaginationQueryType;

    const filterQuery = buildFilterQuery();

    const paginationResult = await mongooseModels.metriSafeModel.paginate(filterQuery, {
      customLabels: mongoosePaginateCustomLabels,
      lean: true,
      limit: queryParsed.limit,
      page: queryParsed.page,
      select: 'address isOG owners gnosisPaySafe',
      populate: {
        path: 'gnosisPaySafe',
        select: 'address isOG owners',
      },
      sort: { address: 1 }, // Sort by address ascending
    });

    returnOakSuccessResponse(ctx, {
      data: paginationResult,
      meta: {
        status: 200,
      },
    });
  });

  router.post(
    '/pay-safes',
    withZodValidation(postMetriSafesPaySafesBodyZodSchema),
    async (ctx) => {
      try {
        const { addresses } = ctx.state.validatedData as PostMetriSafesPaySafesBodyZodSchemaType;

        // Normalize addresses to lowercase for consistent cache key
        const normalizedAddresses = addresses.map((addr) => addr.toLowerCase() as Address);

        // Create cache key from sorted normalized addresses
        const addressesKey = [...normalizedAddresses].sort().join(',');
        const cacheKey = `241421-metri-addr-to-gnosis-pay-safe-addr-${addressesKey}-${Date.now()}`;

        // Use 24 hour cache duration since this mapping is relatively stable
        const cacheDuration = CACHE_DURATION.OLDER_WEEK;

        await withCache(
          redisCache,
          cacheKey,
          cacheDuration,
          ctx,
          async () => {
            // Build response array with metriAddress and paySafe using getGnosisPaySafesFromMetriSafes
            // Call once with all addresses for efficiency
            const data = await getGnosisPaySafesFromMetriSafes(normalizedAddresses);

            return {
              data: {
                resultsArray: data.resultsArray,
                resultsMap: Object.fromEntries(data.resultsMap),
              },
              meta: {
                status: 200,
              },
            };
          },
          {
            errorCode: 'METRI_PAY_SAFES_MAPPING_ERROR',
            errorMessage: 'Failed to fetch Metri safes pay safes mapping',
          },
        );
      } catch (error) {
        logger?.error('Failed to fetch Metri safes pay safes mapping', error);

        returnOakErrorResponse(ctx, {
          errors: [
            {
              message: 'Failed to fetch Metri safes pay safes mapping',
              code: 'METRI_PAY_SAFES_MAPPING_ERROR',
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
    },
  );

  return router;
}
