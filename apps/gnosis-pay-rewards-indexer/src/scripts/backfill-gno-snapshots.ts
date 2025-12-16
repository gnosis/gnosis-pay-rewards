/**
 * Initialize GNO Balance Snapshots at a Starting Block
 *
 * When starting to index from a specific block (e.g., 2 months ago), you need
 * initial GNO balance snapshots for all Safe addresses at that starting block.
 * This ensures the reward calculations have the correct baseline GNO balances.
 *
 * Usage Example:
 * ```typescript
 * import { initializeGnoSnapshotsAtBlock, findBlockNumberByTimestamp } from './backfill-gno-snapshots.js';
 * import dayjs from 'dayjs';
 *
 * // Step 1: Get block number from 2 months ago
 * const twoMonthsAgoTimestamp = dayjs().subtract(2, 'months').unix();
 * const blockNumber = await findBlockNumberByTimestamp(client, twoMonthsAgoTimestamp, logger);
 *
 * if (!blockNumber) {
 *   throw new Error('Could not find block number for 2 months ago');
 * }
 *
 * // Step 2: Create initial snapshots for all Safe addresses at that block
 * // Note: If you don't have Safe addresses in DB yet, this will create 0 snapshots
 * // but that's OK - snapshots will be created as Safes are discovered during indexing
 * const result = await initializeGnoSnapshotsAtBlock({
 *   mongooseModels,
 *   client,
 *   logger,
 *   blockNumber,
 * });
 *
 * console.log(`Created ${result.totalSnapshotsCreated} initial snapshots`);
 *
 * // Step 3: Start normal indexing from that block
 * // The indexer will continue creating snapshots as it processes transfer logs
 * await startIndexing({
 *   client,
 *   mongooseModels,
 *   logger,
 *   // Set fromBlockNumberInitial to blockNumber in your config
 * });
 * ```
 *
 * How it works:
 * 1. Gets all Safe addresses from the database (or discovers them if needed)
 * 2. For each Safe address, creates a GNO balance snapshot at the specified block
 * 3. Skips addresses that already have a snapshot at that block (idempotent)
 */

import {
  GnosisTokenBalanceSnapshotModelType,
  WeekCashbackRewardModelType,
  GnosisPaySafeAddressModelType,
} from '@karpatkey/gnosis-pay-rewards-sdk/mongoose';
import { WeekIdFormatType } from '@karpatkey/gnosis-pay-rewards-sdk';
import { Address, PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';
import { Logger } from 'winston';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

import { takeGnosisTokenBalanceSnapshot } from '../process/processGnosisTokenTransferLog.js';
import { GnosisChainPublicClient } from '../process/types.js';
import { getBlockByNumber } from '../getBlockByNumber.js';

dayjs.extend(utc);

type InitializeGnoSnapshotsAtBlockParams = {
  mongooseModels: {
    gnosisPaySafeAddressModel: GnosisPaySafeAddressModelType;
    gnosisTokenBalanceSnapshotModel: GnosisTokenBalanceSnapshotModelType;
    weekCashbackRewardModel: WeekCashbackRewardModelType;
  };
  client: GnosisChainPublicClient;
  logger: Logger;
  /**
   * Block number to create snapshots at (e.g., block from 2 months ago)
   */
  blockNumber: bigint;
  /**
   * Optional: specific Safe addresses to initialize (if not provided, initializes all Safes)
   */
  safeAddresses?: Address[];
};

/**
 * Estimate block number from timestamp using average block time
 * Gnosis chain has ~5 second block time
 */
export async function estimateBlockNumberFromTimestamp(
  client: PublicClient<Transport, typeof gnosis>,
  targetTimestamp: number,
): Promise<bigint> {
  const currentBlock = await client.getBlockNumber();
  const currentBlockData = await client.getBlock({ blockNumber: currentBlock });
  const currentTimestamp = Number(currentBlockData.timestamp);

  // Average block time for Gnosis is ~5 seconds
  const AVERAGE_BLOCK_TIME_SECONDS = 5;
  const timeDifference = currentTimestamp - targetTimestamp;
  const blocksDifference = BigInt(Math.floor(timeDifference / AVERAGE_BLOCK_TIME_SECONDS));

  // Estimate: current block - blocks difference
  const estimatedBlock = currentBlock > blocksDifference ? currentBlock - blocksDifference : 0n;

  return estimatedBlock;
}

/**
 * Find block number closest to target timestamp using binary search
 */
export async function findBlockNumberByTimestamp(
  client: PublicClient<Transport, typeof gnosis>,
  targetTimestamp: number,
  logger: Logger,
): Promise<bigint | null> {
  try {
    // First, try to estimate
    const estimatedBlock = await estimateBlockNumberFromTimestamp(client, targetTimestamp);

    // Get the block to check its timestamp
    const { data: block, error } = await getBlockByNumber({
      blockNumber: estimatedBlock,
      client,
      useCache: true,
    });

    if (error || !block) {
      logger.warn(`Could not get estimated block ${estimatedBlock}, trying binary search`);
      // Fall back to binary search if estimation fails
      return await binarySearchBlockByTimestamp(client, targetTimestamp, logger);
    }

    const blockTimestamp = Number(block.timestamp);
    const timeDiff = Math.abs(blockTimestamp - targetTimestamp);

    // If we're within 30 seconds, this is good enough
    if (timeDiff <= 30) {
      return estimatedBlock;
    }

    // Otherwise, use binary search for more accuracy
    return await binarySearchBlockByTimestamp(client, targetTimestamp, logger);
  } catch (error) {
    logger.error(`Error finding block by timestamp: ${error}`);
    return null;
  }
}

/**
 * Binary search to find block number closest to target timestamp
 */
async function binarySearchBlockByTimestamp(
  client: PublicClient<Transport, typeof gnosis>,
  targetTimestamp: number,
  logger: Logger,
): Promise<bigint | null> {
  try {
    const currentBlock = await client.getBlockNumber();
    let low = 0n;
    let high = currentBlock;
    let closestBlock = currentBlock;
    let closestDiff = Infinity;

    // Binary search with a reasonable limit
    const maxIterations = 50;
    let iterations = 0;

    while (low <= high && iterations < maxIterations) {
      iterations++;
      const mid = (low + high) / 2n;

      const { data: block, error } = await getBlockByNumber({
        blockNumber: mid,
        client,
        useCache: true,
      });

      if (error || !block) {
        // If we can't get this block, adjust search range
        if (mid > 0n) {
          high = mid - 1n;
        } else {
          break;
        }
        continue;
      }

      const blockTimestamp = Number(block.timestamp);
      const diff = Math.abs(blockTimestamp - targetTimestamp);

      if (diff < closestDiff) {
        closestDiff = diff;
        closestBlock = mid;
      }

      if (blockTimestamp < targetTimestamp) {
        low = mid + 1n;
      } else if (blockTimestamp > targetTimestamp) {
        high = mid - 1n;
      } else {
        // Exact match
        return mid;
      }
    }

    logger.info(`Found closest block ${closestBlock} (diff: ${closestDiff}s) for timestamp ${targetTimestamp}`);
    return closestBlock;
  } catch (error) {
    logger.error(`Error in binary search: ${error}`);
    return null;
  }
}


/**
 * Initialize GNO balance snapshots at a specific block number
 * This is used when starting indexing from a specific point in time (e.g., 2 months ago)
 * to ensure all Safe addresses have initial GNO balance snapshots at the starting block
 */
export async function initializeGnoSnapshotsAtBlock({
  mongooseModels,
  client,
  logger,
  blockNumber,
  safeAddresses,
}: InitializeGnoSnapshotsAtBlockParams): Promise<{
  totalSnapshotsCreated: number;
  totalSnapshotsSkipped: number;
  errors: Array<{ safeAddress: Address; error: string }>;
}> {
  const { gnosisPaySafeAddressModel, gnosisTokenBalanceSnapshotModel, weekCashbackRewardModel } = mongooseModels;

  logger.info(`Initializing GNO snapshots at block ${blockNumber}`);

  // Verify the block exists
  const { data: block, error: blockError } = await getBlockByNumber({
    blockNumber,
    client,
    useCache: true,
  });

  if (blockError || !block) {
    throw new Error(`Block ${blockNumber} not found: ${blockError?.message || 'Unknown error'}`);
  }

  logger.info(`Block ${blockNumber} found, timestamp: ${block.timestamp}`);

  // Get Safe addresses to initialize
  let addressesToInitialize: Address[];
  if (safeAddresses && safeAddresses.length > 0) {
    addressesToInitialize = safeAddresses.map((addr) => addr.toLowerCase() as Address);
    logger.info(`Initializing snapshots for ${addressesToInitialize.length} specific Safe addresses`);
  } else {
    const allSafes = await gnosisPaySafeAddressModel.find({}).select({ address: 1 }).lean();
    addressesToInitialize = allSafes.map((safe) => safe.address.toLowerCase() as Address);
    logger.info(`Initializing snapshots for all ${addressesToInitialize.length} Safe addresses`);
  }

  if (addressesToInitialize.length === 0) {
    logger.warn('No Safe addresses found in database. Snapshots will be created as Safes are discovered during indexing.');
    return {
      totalSnapshotsCreated: 0,
      totalSnapshotsSkipped: 0,
      errors: [],
    };
  }

  let totalSnapshotsCreated = 0;
  let totalSnapshotsSkipped = 0;
  const errors: Array<{ safeAddress: Address; error: string }> = [];

  // Process each Safe address
  for (let i = 0; i < addressesToInitialize.length; i++) {
    const safeAddress = addressesToInitialize[i];
    const progress = `[${i + 1}/${addressesToInitialize.length}]`;

    try {
      logger.debug(`${progress} Creating snapshot for Safe ${safeAddress} at block ${blockNumber}`);

      await takeGnosisTokenBalanceSnapshot({
        gnosisTokenBalanceSnapshotModel,
        weekCashbackRewardModel,
        gnosisPaySafeAddressModel,
        safeAddress,
        client,
        blockNumber,
      });

      totalSnapshotsCreated++;
      logger.debug(`${progress} ✓ Created snapshot for ${safeAddress}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if it's a "already processed" error (which is fine - snapshot already exists)
      if (errorMessage.includes('already processed') || errorMessage.includes('LOG_ALREADY_PROCESSED')) {
        totalSnapshotsSkipped++;
        logger.debug(`${progress} ⊘ Snapshot already exists for ${safeAddress}`);
      } else {
        logger.error(`${progress} ✗ Error creating snapshot for ${safeAddress}: ${errorMessage}`);
        errors.push({ safeAddress, error: errorMessage });
      }
    }
  }

  logger.info(
    `Initialization complete at block ${blockNumber}: ${totalSnapshotsCreated} created, ${totalSnapshotsSkipped} skipped, ${errors.length} errors`,
  );

  return {
    totalSnapshotsCreated,
    totalSnapshotsSkipped,
    errors,
  };
}

