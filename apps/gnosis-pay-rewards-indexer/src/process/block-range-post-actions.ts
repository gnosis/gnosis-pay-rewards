import { Logger } from 'winston';
import { GnosisChainPublicClient } from './types.ts';
import { BlockDocumentFieldsType, tokenBalanceSnapshotTokens, toWeekId } from '@kpk/gnosis-pay-rewards-sdk';
import { CreateModelsReturnType, ProcessedBlockModelType } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import { GNOSIS_TOKEN_SNAPSHOT_BLOCK_INTERVAL, TOKEN_PRICE_SNAPSHOT_BLOCK_INTERVAL } from '../config/env.ts';
import { handleTokenPriceRecording } from './token-prices.ts';
import { buildRetryOptions } from '../gp/commons.ts';
import { Address, isAddressEqual } from 'viem';
import { retry } from '../lib/retry.ts';
import { takeTokenBalanceSnapshot } from './token-transfer.ts';
import type { BlockInfo, BlockInfoProvider } from '../lib/block-info-provider.ts';
import type { RedisCache } from '../lib/redis-cache.ts';

type Params = {
  fromBlock: number;
  toBlock: number;
  client: GnosisChainPublicClient;
  mongooseModels: CreateModelsReturnType;
  logger?: Logger;
  blockInfoProvider: BlockInfoProvider;
  redisCache: RedisCache;
};

/**
 * Saves a single block to the database
 */
async function saveBlock(model: ProcessedBlockModelType, blockInfo: BlockInfo) {
  const blockDocument = await model.findOne({ number: blockInfo.number });

  if (blockDocument) {
    return blockDocument;
  }

  return new model<BlockDocumentFieldsType>({
    ...blockInfo,
    _id: blockInfo.number,
    week: toWeekId(blockInfo.timestamp),
  }).save();
}

/**
 * Checks for missing token snapshots for a single block for all tokens in tokenBalanceSnapshotTokens
 * Checks both Gnosis Pay Safes and Metri Safes
 */
async function checkForMissingTokenSnapshotsAtBlock(
  block: BlockInfo,
  mongooseModels: CreateModelsReturnType,
  client: GnosisChainPublicClient,
  blockInfoProvider: BlockInfoProvider,
) {
  const {
    gnosisPaySafeModel,
    metriSafeModel,
    tokenBalanceSnapshotModel,
    safeWeekRewardsSnapshotModel,
  } = mongooseModels;

  const weekId = toWeekId(block.timestamp);
  const gnosisPaySafeAddresses = (await gnosisPaySafeModel.find().select({ address: 1 }).lean()).map(
    ({ address }) => address,
  );
  const metriSafeAddresses = (await metriSafeModel.find().select({ address: 1 }).lean()).map((
    { address },
  ) => address);

  const tokenBalanceSnapshots = await tokenBalanceSnapshotModel.find({
    week: weekId,
  }).lean();

  // Check all tokens for Gnosis Pay Safes
  for (const safeAddress of gnosisPaySafeAddresses) {
    for (const token of tokenBalanceSnapshotTokens) {
      const doesHaveTokenBalanceSnapshot = tokenBalanceSnapshots.some(
        (snapshot) =>
          isAddressEqual(snapshot.address, safeAddress) &&
          isAddressEqual(snapshot.token as Address, token.address),
      );

      if (!doesHaveTokenBalanceSnapshot) {
        await takeTokenBalanceSnapshot(
          {
            safeModel: gnosisPaySafeModel,
            tokenBalanceSnapshotModel,
            safeWeekRewardsSnapshotModel,
            client,
            blockInfoProvider,
          },
          {
            address: safeAddress,
            token,
            blockNumber: BigInt(block.number),
          },
        ).catch((error) => {
          // Log error but don't throw - snapshot failures for individual safes/tokens shouldn't break the flow
          console.error(
            `Failed to take token snapshot for Gnosis Pay Safe ${safeAddress} token ${token.symbol}:`,
            error,
          );
        });
      }
    }
  }

  // Check all tokens for Metri Safes
  for (const safeAddress of metriSafeAddresses) {
    for (const token of tokenBalanceSnapshotTokens) {
      const doesHaveTokenBalanceSnapshot = tokenBalanceSnapshots.some(
        (snapshot) =>
          isAddressEqual(snapshot.address, safeAddress) &&
          isAddressEqual(snapshot.token as Address, token.address),
      );

      if (!doesHaveTokenBalanceSnapshot) {
        await takeTokenBalanceSnapshot(
          {
            safeModel: metriSafeModel,
            tokenBalanceSnapshotModel,
            safeWeekRewardsSnapshotModel,
            client,
            blockInfoProvider,
          },
          {
            address: safeAddress,
            token,
            blockNumber: BigInt(block.number),
          },
        ).catch((error) => {
          // Log error but don't throw - snapshot failures for individual safes/tokens shouldn't break the flow
          console.error(
            `Failed to take token snapshot for Metri Safe ${safeAddress} token ${token.symbol}:`,
            error,
          );
        });
      }
    }
  }
}

/**
 * Handle a chunk of blocks - processes blocks in chunks of 10
 * For each block: ensures both checkForMissingGnoTokenSnapshots and takeTokenPrices complete,
 * then saves the block to database. This ensures the indexer can pick up from the latest saved block.
 */
export async function runRangePostProcessingOperations(params: Params) {
  const {
    fromBlock,
    toBlock,
    client,
    mongooseModels,
    logger,
    blockInfoProvider,
    redisCache,
  } = params;

  const chunkLogger = logger?.child({
    operation: 'handleBlockChunk',
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
  });

  const CHUNK_SIZE = 100;

  // Process blocks in chunks of 10
  for (
    let chunkStart = fromBlock;
    chunkStart <= toBlock;
    chunkStart += CHUNK_SIZE
  ) {
    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE - 1, toBlock);
    const chunkBlockNumbers = Array.from(
      { length: chunkEnd - chunkStart + 1 },
      (_, i) => chunkStart + i,
    );

    // Fetch block info for this chunk
    const blockInfoMap = await blockInfoProvider.getBlocksInfo(
      chunkBlockNumbers,
    );

    // Process each block in the chunk sequentially
    for (const blockNumber of chunkBlockNumbers) {
      const blockInfo = blockInfoMap.get(blockNumber);

      if (!blockInfo) {
        chunkLogger?.warn(`block ${blockNumber} info not found, skipping`);
        continue;
      }

      try {
        // Ensure both operations complete for this block
        if (blockNumber % GNOSIS_TOKEN_SNAPSHOT_BLOCK_INTERVAL === 0) {
          await checkForMissingTokenSnapshotsAtBlock(
            blockInfo,
            mongooseModels,
            client,
            blockInfoProvider,
          );
        }

        if (blockNumber % TOKEN_PRICE_SNAPSHOT_BLOCK_INTERVAL === 0) {
          await retry(
            () =>
              handleTokenPriceRecording({
                blockNumber: BigInt(blockNumber),
                client,
                logger,
                mongooseModels,
                blockInfoProvider,
                redisCache,
              }),
            buildRetryOptions({
              name: 'handleTokenPriceRecording',
              logger,
            }),
          );
        }

        // Only save the block after both operations complete
        await saveBlock(mongooseModels.processedBlockModel, blockInfo);
      } catch (error) {
        logger?.error(`error processing block ${blockNumber}: ${error}`);
        throw error;
      } finally {
        logger?.info(`completed block ${blockNumber}`);
      }
    }
  }
}
