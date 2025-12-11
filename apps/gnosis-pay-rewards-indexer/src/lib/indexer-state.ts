import { IndexerStateType, indexerStateZodSchema } from '@kpk/gnosis-pay-rewards-sdk';
import { gnosis } from 'viem/chains';
import { Logger } from 'winston';
import { PublicClient, Transport } from 'viem';
import { dayjsUtc as dayjs } from './dayjs-utc.ts';
import { updatedDiff } from 'deep-object-diff';
import type { RedisCache } from './redis-cache.ts';

type BlockNumberType = bigint | number;

type StateWithoutIdType = Omit<IndexerStateType, 'id'>;

const INDEXER_STATE_REDIS_KEY_PREFIX = 'gpr-indexer:state:';
const INDEXER_ACTIVE_IDS_REDIS_KEY = 'gpr-indexer:active-ids';

type InitializeParamsType = {
  id: string;
  client: PublicClient<Transport, typeof gnosis>;
  fetchBlockSize: BlockNumberType;
  startBlock: BlockNumberType;
  logger?: Logger;
  redisCache: RedisCache;
};

/**
 * Class for managing indexer state
 */
export class IndexerState {
  private state: IndexerStateType;

  public readonly id: string;

  private redisCache: RedisCache;

  private constructor(id: string, redisCache: RedisCache) {
    this.id = id;
    this.redisCache = redisCache;
    const initialState = {
      id,
      startedAt: dayjs.utc().unix(),
      startBlock: 0,
      fetchBlockSize: 12 * 5,
      latestBlock: 0,
      distanceToLatestBlock: 0,
      range: {
        fromBlock: 0,
        toBlock: 0,
      },
    };
    // Validate initial state
    this.state = indexerStateZodSchema.parse(initialState);
  }

  /**
   * Get the indexer state
   * @returns the indexer state
   */
  getState(): Readonly<IndexerStateType> {
    return { ...this.state };
  }

  /**
   * Initialize the indexer state
   */
  static async initialize(params: InitializeParamsType) {
    const { id, client, logger, redisCache } = params;

    const fetchBlockSize = toNumber(params.fetchBlockSize);
    const startBlock = toNumber(params.startBlock);
    // Initialize the latest block
    const latestBlockNumberInitial = toNumber(await client.getBlockNumber());

    // If the start block is already past the latest block, set both to latest block
    // This ensures we have a valid range and the indexer will wait for new blocks
    let effectiveFromBlock = startBlock;
    let effectiveToBlock = clampToBlockRange(startBlock, latestBlockNumberInitial, fetchBlockSize);

    if (effectiveFromBlock > latestBlockNumberInitial) {
      logger?.info(
        `Start block ${effectiveFromBlock} is past latest block ${latestBlockNumberInitial}, adjusting to latest block`,
        {
          id,
          startBlock,
          latestBlockNumberInitial,
        },
      );
      effectiveFromBlock = latestBlockNumberInitial;
      effectiveToBlock = latestBlockNumberInitial;
    }

    // Ensure fromBlock <= toBlock (should always be true after above check, but double-check)
    if (effectiveFromBlock > effectiveToBlock) {
      effectiveToBlock = effectiveFromBlock;
    }

    const instance = new IndexerState(id, redisCache);
    // Update the indexer state
    instance.updateState(
      {
        startedAt: dayjs.utc().unix(),
        startBlock,
        fetchBlockSize,
        latestBlock: latestBlockNumberInitial,
        distanceToLatestBlock: Math.abs(latestBlockNumberInitial - startBlock),
        range: {
          fromBlock: effectiveFromBlock,
          toBlock: effectiveToBlock,
        },
      },
      logger,
    );

    // Calculate initial sync percentage
    instance.updateSyncPercentage(logger);

    // Save initial state to Redis
    await instance.saveStateToRedis(logger);

    // Register this indexer ID in the active indexers set
    await instance.registerIndexerId(logger);

    return instance;
  }

  /**
   * Get the Redis key for this indexer's state
   */
  private getRedisKey(): string {
    return `${INDEXER_STATE_REDIS_KEY_PREFIX}${this.id}`;
  }

  static createRedisKey(id: string): string {
    return `${INDEXER_STATE_REDIS_KEY_PREFIX}${id}`;
  }

  static getRedisKeyPattern(): string {
    return `${INDEXER_STATE_REDIS_KEY_PREFIX}*`;
  }

  static getActiveIndexerIdsKey(): string {
    return INDEXER_ACTIVE_IDS_REDIS_KEY;
  }

  /**
   * Register this indexer ID in the active indexers set
   * @param logger - the logger to use
   */
  private async registerIndexerId(logger?: Logger): Promise<void> {
    await this.redisCache.sAdd(INDEXER_ACTIVE_IDS_REDIS_KEY, this.id);
    logger?.debug('Registered indexer ID in active indexers set', {
      indexerId: this.id,
    });
  }

  /**
   * Unregister this indexer ID from the active indexers set
   * @param logger - the logger to use
   */
  async unregisterIndexerId(logger?: Logger): Promise<void> {
    await this.redisCache.sRem(INDEXER_ACTIVE_IDS_REDIS_KEY, this.id);
    logger?.debug('Unregistered indexer ID from active indexers set', {
      indexerId: this.id,
    });
  }

  /**
   * Save the current state to Redis
   * @param logger - the logger to use
   */
  private async saveStateToRedis(logger?: Logger): Promise<void> {
    const stateJson = this.toJSON();
    await this.redisCache.set(this.getRedisKey(), stateJson);
    logger?.debug('Saved indexer state to Redis', {
      indexerId: this.id,
      state: stateJson,
    });
  }

  /**
   * Update the indexer state
   * @param newState - the new state to update
   * @param logger - the logger to use for the update
   */
  private updateState(newState: Partial<StateWithoutIdType>, logger?: Logger): void {
    const prevState = { ...this.state };

    // Construct the next state
    const nextStateRaw = {
      ...prevState,
      ...newState,
    };

    // Validate the merged state using Zod schema
    const nextState = indexerStateZodSchema.parse(nextStateRaw);
    const stateDiff = updatedDiff(prevState, nextState);

    // Create a detailed diff showing old vs new values
    const detailedDiff: Record<string, { old: unknown; new: unknown }> = {};
    for (const key of Object.keys(stateDiff)) {
      const keyTyped = key as keyof IndexerStateType;
      detailedDiff[key] = {
        old: prevState[keyTyped],
        new: nextState[keyTyped],
      };
    }

    if (Object.keys(detailedDiff).length > 0) {
      logger?.verbose(`state diff`, {
        detailedDiff,
      });

      logger?.verbose(`updated state`, {
        state: nextState,
      });

      this.state = nextState;

      // Save updated state to Redis (fire and forget)
      this.saveStateToRedis(logger).catch((error) => {
        logger?.warn('Failed to save state to Redis after update', {
          indexerId: this.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  /**
   * Update the distance to the latest block number
   * @param latestBlock - the latest block number
   * @param logger - the logger to use for the update
   */
  updateLatestBlockNumber(latestBlock: BlockNumberType, logger?: Logger): void {
    // Convert the latest block number to a number
    latestBlock = toNumber(latestBlock);

    // Validate the latest block number
    if (latestBlock < this.state.range.toBlock) {
      throw new Error(
        `latest block number (${latestBlock}) is less than the to block number (${this.state.range.toBlock})`,
      );
    }

    const distanceToLatestBlock = Math.abs(latestBlock - this.state.range.toBlock);
    this.updateState(
      {
        latestBlock,
        distanceToLatestBlock,
      },
      logger,
    );

    // Recalculate estimated time to chain head after updating distance
    this.updateEstimatedTimeToChainHead(logger);
    // Recalculate sync percentage after updating latest block
    this.updateSyncPercentage(logger);
  }

  setStartBlock(startBlock: BlockNumberType, logger?: Logger): void {
    this.updateState(
      {
        startBlock: toNumber(startBlock),
      },
      logger,
    );
  }

  /**
   * Move to the next block range
   * @param logger - the logger to use for the update
   * @param blockSize - optional block size to use instead of fetchBlockSize (useful for following mode)
   * @returns the next range
   */
  moveToNextBlockRange(params: { logger?: Logger; blockSize?: BlockNumberType }): IndexerStateType['range'] {
    const { logger, blockSize } = params;
    const { range, startBlock, fetchBlockSize, latestBlock } = this.state;
    const effectiveBlockSize = blockSize ? toNumber(blockSize) : fetchBlockSize;

    const nextRange: IndexerStateType['range'] = {
      fromBlock: range.toBlock + 1, // Start from the next block after the previous range
      toBlock: clampToBlockRange(range.toBlock + 1, latestBlock, effectiveBlockSize),
    };

    // Validate the range
    if (nextRange.fromBlock < startBlock) {
      throw new Error(`updateRange: fromBlock (${nextRange.fromBlock}) is less than the startBlock (${startBlock})`);
    }

    // from block number must be less than to block number
    if (nextRange.fromBlock >= nextRange.toBlock) {
      nextRange.fromBlock = nextRange.toBlock - effectiveBlockSize;
      nextRange.toBlock = clampToBlockRange(nextRange.fromBlock, latestBlock, effectiveBlockSize);
    }

    const distanceToLatestBlock = Math.abs(latestBlock - nextRange.toBlock);

    this.updateState(
      {
        range: nextRange,
        distanceToLatestBlock,
      },
      logger,
    );

    // Recalculate estimated time to chain head after moving to next range
    this.updateEstimatedTimeToChainHead(logger);
    // Recalculate sync percentage after moving to next range
    this.updateSyncPercentage(logger);

    return nextRange;
  }

  /**
   * Check if the indexer should fetch logs
   * @param state - the indexer state
   * @returns true if the indexer should fetch logs, false otherwise
   */
  shouldFetchLogs() {
    const { range, latestBlock } = this.state;
    const shouldFetchLogs = range.toBlock <= latestBlock;
    return shouldFetchLogs;
  }

  /**
   * Update the average processing time for ranges
   * @param processingTimeSeconds - the processing time in seconds for the current range
   * @param logger - the logger to use for the update
   */
  updateAverageProcessingTime(processingTimeSeconds: number, logger?: Logger): void {
    const currentCount = this.state.processing?.rangeCount ?? 0;
    const currentAverage = this.state.processing?.avgTimeSec ?? 0;

    // Calculate new average using running average formula
    // newAverage = (oldAverage * oldCount + newValue) / (oldCount + 1)
    const newCount = currentCount + 1;
    const newAverage = (currentAverage * currentCount + processingTimeSeconds) / newCount;

    this.updateState(
      {
        processing: {
          avgTimeSec: newAverage,
          rangeCount: newCount,
        },
      },
      logger,
    );

    // Recalculate estimated time to chain head after updating average
    this.updateEstimatedTimeToChainHead(logger);
  }

  /**
   * Calculate and update the estimated time to reach the chain head
   * @param logger - the logger to use for the update
   */
  updateEstimatedTimeToChainHead(logger?: Logger): void {
    const { distanceToLatestBlock, fetchBlockSize } = this.state;
    const averageProcessingTimeSeconds = this.state.processing?.avgTimeSec;

    // If we don't have average processing time yet, can't estimate
    if (!averageProcessingTimeSeconds || averageProcessingTimeSeconds === 0) {
      this.updateState(
        {
          estimates: {
            timeToHeadSec: undefined,
          },
        },
        logger,
      );
      return;
    }

    // If we're already at the chain head, no time needed
    if (distanceToLatestBlock <= 0) {
      this.updateState(
        {
          estimates: {
            timeToHeadSec: 0,
          },
        },
        logger,
      );
      return;
    }

    // Constants matching core.ts
    const FOLLOWING_MODE_THRESHOLD = 10;
    const FOLLOWING_BLOCK_SIZE = 10;

    // Calculate estimated time considering following mode
    let estimatedTime = 0;
    let remainingDistance = distanceToLatestBlock;

    // Calculate time for normal mode (until we reach following mode threshold)
    let normalModeRanges = 0;
    let normalModeTime = 0;
    if (remainingDistance > FOLLOWING_MODE_THRESHOLD) {
      const normalModeDistance = remainingDistance - FOLLOWING_MODE_THRESHOLD;
      normalModeRanges = Math.ceil(normalModeDistance / fetchBlockSize);
      normalModeTime = normalModeRanges * averageProcessingTimeSeconds;
      estimatedTime += normalModeTime;
      remainingDistance = FOLLOWING_MODE_THRESHOLD;
    }

    // Calculate time for following mode (last 10 blocks)
    let followingModeRanges = 0;
    let followingModeTime = 0;
    if (remainingDistance > 0) {
      followingModeRanges = Math.ceil(remainingDistance / FOLLOWING_BLOCK_SIZE);
      // In following mode, processing is typically faster, but we'll use the same average for simplicity
      // Alternatively, we could track a separate average for following mode
      followingModeTime = followingModeRanges * averageProcessingTimeSeconds;
      estimatedTime += followingModeTime;
    }

    // Round to 2 decimal places
    const roundedEstimatedTime = Math.round(estimatedTime * 100) / 100;

    // Log calculation breakdown for debugging
    logger?.debug('estimated time to chain head calculation', {
      distanceToLatestBlock,
      fetchBlockSize,
      averageProcessingTimeSeconds: Math.round(averageProcessingTimeSeconds * 100) / 100,
      normalModeRanges,
      normalModeTime: Math.round(normalModeTime * 100) / 100,
      followingModeRanges,
      followingModeTime: Math.round(followingModeTime * 100) / 100,
      totalEstimatedTimeSeconds: roundedEstimatedTime,
      totalEstimatedTimeHours: Math.round((roundedEstimatedTime / 3600) * 100) / 100,
      totalEstimatedTimeDays: Math.round((roundedEstimatedTime / 86400) * 100) / 100,
    });

    this.updateState(
      {
        estimates: {
          timeToHeadSec: roundedEstimatedTime,
        },
      },
      logger,
    );

    // Recalculate sync percentage after updating estimated time
    this.updateSyncPercentage(logger);
  }

  /**
   * Calculate and update the sync percentage (0-100)
   * @param logger - the logger to use for the update
   */
  updateSyncPercentage(logger?: Logger): void {
    const { startBlock, latestBlock, range } = this.state;

    // If startBlock and latestBlock are the same, we're at 100%
    if (startBlock === latestBlock) {
      this.updateState(
        {
          syncPct: 100,
        },
        logger,
      );
      return;
    }

    // Calculate how many blocks we've processed (from startBlock to current toBlock)
    const blocksProcessed = range.toBlock - startBlock;
    const totalBlocks = latestBlock - startBlock;

    // Calculate percentage, clamped between 0 and 100
    let syncPercentage = 0;
    if (totalBlocks > 0) {
      syncPercentage = Math.min(100, Math.max(0, (blocksProcessed / totalBlocks) * 100));
    }

    // Round to 2 decimal places
    const roundedSyncPercentage = Math.round(syncPercentage * 100) / 100;

    this.updateState(
      {
        syncPct: roundedSyncPercentage,
      },
      logger,
    );
  }

  /**
   * Get the JSON representation of the indexer state
   */
  toJSON(): Readonly<IndexerStateType> {
    return this.getState();
  }
}

/**
 * Convert a bigint or number to a number
 */
function toNumber(value: bigint | number): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

/**
 * Clamp the block range to ensure it doesn't exceed the latest block
 */
function clampToBlockRange(
  startBlock: BlockNumberType,
  latestBlockNumber: BlockNumberType,
  blockSize: BlockNumberType,
): number {
  const toBlock = toNumber(startBlock) + toNumber(blockSize);

  // Convert the latest block number to a number
  latestBlockNumber = toNumber(latestBlockNumber);
  return toBlock >= latestBlockNumber ? latestBlockNumber : toBlock;
}
