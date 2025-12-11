import { Address, PublicClient } from 'viem';
import { CreateModelsReturnType } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import { TokenBalanceSnapshotFieldsType, WeekIdFormatType } from '@kpk/gnosis-pay-rewards-sdk';
import { GetTokenBalanceSnapshotsQueryZodSchemaType } from './router-zod.ts';
import { buildFilterQuery } from './functions.ts';
import { toWeekId } from '@kpk/gnosis-pay-rewards-sdk';
import { FilterQuery } from 'mongoose';
import { tokenBalanceSnapshotTokens } from '@kpk/gnosis-pay-rewards-sdk';
import { isMetriSafeWithRedisCache, takeTokenBalanceSnapshot } from '../process/token-transfer.ts';
import { mongoosePaginateCustomLabels } from '@kpk/apps-sdk/api';
import type { BlockInfoProvider } from '../lib/block-info-provider.ts';
import type { RedisCache } from '../lib/redis-cache.ts';
import type { Logger } from 'winston';
import { Transport } from 'viem';
import { gnosis } from 'viem/chains';
import { isGnosisPaySafeAddress } from '../gp/isGnosisPaySafeAddress.ts';

type GetTokenBalanceSnapshotsDeps = {
  mongooseModels: CreateModelsReturnType;
  client: PublicClient<Transport, typeof gnosis>;
  blockInfoProvider: BlockInfoProvider;
  redisCache: RedisCache;
  logger?: Logger;
};

async function resolveSafeModel(deps: GetTokenBalanceSnapshotsDeps, address?: Address) {
  const { mongooseModels, client } = deps;
  const { gnosisPaySafeModel, metriSafeModel } = mongooseModels;

  // No address provided, return undefined
  if (!address) {
    return undefined;
  }

  const isGnosisPaySafeResult = await isGnosisPaySafeAddress({
    address,
    client,
    gnosisPaySafeModel,
  });

  if (isGnosisPaySafeResult.isGnosisPaySafe) {
    return gnosisPaySafeModel;
  }

  const addressIsMetriSafe = await isMetriSafeWithRedisCache(address, deps.redisCache);

  if (addressIsMetriSafe) {
    return metriSafeModel;
  }
}

export async function getTokenBalanceSnapshots(
  deps: GetTokenBalanceSnapshotsDeps,
  params: GetTokenBalanceSnapshotsQueryZodSchemaType,
) {
  const { mongooseModels, client, blockInfoProvider, logger } = deps;
  const { tokenBalanceSnapshotModel, safeWeekRewardsSnapshotModel } = mongooseModels;
  const safeModel = await resolveSafeModel(deps, params.address);
  const { page, limit, ...paramsWithoutPagination } = params;

  // Determine block number(s) from week or block parameter
  let blockNumbers: Array<{ blockNumber: bigint; queryBlock: number }> = [];
  let week: WeekIdFormatType | undefined;
  let queryBlocks: number[] = [];
  let shouldCheckByWeek = false;

  if (params.week) {
    week = params.week;
    shouldCheckByWeek = true;

    // Get 5 random blocks from the week
    blockNumbers = await blockInfoProvider.getRandomBlocksFromWeek(week, 5);
    queryBlocks = blockNumbers.map((b) => b.queryBlock);
  } else if (params.block) {
    const queryBlock = params.block;
    blockNumbers = [{ blockNumber: BigInt(queryBlock), queryBlock }];
    queryBlocks = [queryBlock];
    // Get block info to determine the week
    const blockInfo = await blockInfoProvider.getBlockInfo(queryBlock);
    week = toWeekId(blockInfo.timestamp);
  } else {
    // If neither week nor block is provided, use current block
    const currentBlock = await client.getBlockNumber();
    const currentBlockNumber = Number(currentBlock);
    blockNumbers = [
      {
        blockNumber: currentBlock,
        queryBlock: currentBlockNumber,
      },
    ];
    queryBlocks = [currentBlockNumber];
    const blockInfo = await blockInfoProvider.getBlockInfo(currentBlockNumber);
    week = toWeekId(blockInfo.timestamp);
  }

  // Take snapshots if address is provided and safeModel is resolved
  // When a block number is specified, we always ensure snapshots are taken at that block
  if (params.address && safeModel) {
    console.log({ queryBlocks, shouldCheckByWeek, week });
    // Check if snapshots exist for this address and week/blocks
    // Query by block numbers if we have them, otherwise by week
    const query: FilterQuery<TokenBalanceSnapshotFieldsType> = {
      address: params.address,
    };
    if (queryBlocks.length > 0) {
      query.block = { $in: queryBlocks };
    } else if (shouldCheckByWeek && week) {
      query.week = week;
    }

    const existingSnapshots = await tokenBalanceSnapshotModel.find(query).lean();

    // Group existing snapshots by block and token
    const existingSnapshotsByBlockAndToken = new Map<string, Set<string>>();
    for (const snapshot of existingSnapshots) {
      const block = snapshot.block as number;
      const token = (snapshot.token as Address).toLowerCase();
      const key = `${block}`;
      if (!existingSnapshotsByBlockAndToken.has(key)) {
        existingSnapshotsByBlockAndToken.set(key, new Set());
      }
      existingSnapshotsByBlockAndToken.get(key)!.add(token);
    }

    // Take snapshots for missing tokens at each block
    // When a specific block is provided, ensure snapshots are taken at that block
    // If there are zero snapshots, take snapshots for all tokens at all blocks
    const snapshotPromises: Promise<unknown>[] = [];
    for (const { blockNumber, queryBlock } of blockNumbers) {
      const existingTokensAtBlock = existingSnapshotsByBlockAndToken.get(`${queryBlock}`) || new Set();
      // If zero snapshots exist, take snapshots for all tokens; otherwise only missing tokens
      const tokensToSnapshot = existingSnapshots.length === 0
        ? tokenBalanceSnapshotTokens
        : tokenBalanceSnapshotTokens.filter((token) => !existingTokensAtBlock.has(token.address.toLowerCase()));

      // When a block is explicitly specified, ensure we take snapshots for all tokens at that block
      // (even if some already exist, we'll take the missing ones)
      for (const token of tokensToSnapshot) {
        snapshotPromises.push(
          takeTokenBalanceSnapshot(
            {
              tokenBalanceSnapshotModel,
              safeModel,
              safeWeekRewardsSnapshotModel,
              client,
              blockInfoProvider,
            },
            {
              address: params.address,
              token,
              blockNumber,
            },
          ).catch((error) => {
            // Log error but don't throw - snapshot failures for individual tokens shouldn't break the flow
            logger?.error(
              `Failed to take token snapshot for ${params.address} token ${token.symbol} at block ${queryBlock}:`,
              error,
            );
          }),
        );
      }
    }

    if (snapshotPromises.length > 0) {
      await Promise.all(snapshotPromises);
    }
  }

  // Fetch all snapshots for this address (if provided) and blocks/week
  // If week is provided, filter by week only (not by specific blocks)
  // If block is provided, filter by that specific block using $in format for consistency
  // If neither is provided, don't filter by block or week (return all matching address/token)
  const filterQuery = buildFilterQuery<TokenBalanceSnapshotFieldsType>(paramsWithoutPagination);

  const paginationResult = await tokenBalanceSnapshotModel.paginate(filterQuery, {
    customLabels: mongoosePaginateCustomLabels,
    lean: true,
    limit,
    page,
    populate: [
      {
        path: 'token',
        select: 'address decimals symbol name',
      },
      {
        path: 'block',
        select: 'number timestamp',
      },
    ],
    sort: { block: -1 }, // Sort by block number descending (newest first)
  });

  return paginationResult;
}
