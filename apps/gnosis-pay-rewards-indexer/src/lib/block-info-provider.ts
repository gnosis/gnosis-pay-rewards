import type { Block, PublicClient, Transport } from 'viem';
import { toWeekId, WeekIdFormatType } from '@kpk/gnosis-pay-rewards-sdk';
import { CreateModelsReturnType } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import { gnosis } from 'viem/chains';
import { Logger } from 'winston';
import { retry } from './retry.ts';
import { getBlocksInfo, SubgraphBlockType } from './gnosis-blocks-subgraph.ts';
import { chunkArray } from './utils.ts';
import { RateLimitError } from '../process/errors.ts';
import { dayjsUtc as dayjs } from './dayjs-utc.ts';
import { type RedisCache } from './redis-cache.ts';

export type BlockInfo = SubgraphBlockType & {
  week: WeekIdFormatType;
};

const SUBGRAPH_TIMEOUT_MS = 30 * 1000; // 30 seconds timeout per chunk
const RPC_TIMEOUT_MS = 15 * 1000; // 15 seconds timeout per block
const SUBGRAPH_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes cooldown after rate limit
// Threshold for using archive client (blocks older than this will use archiveClient)
const ARCHIVE_BLOCK_THRESHOLD = 100;

// Gnosis chain: 1 block every 5 seconds
const GNOSIS_CHAIN_BLOCK_TIME_SECONDS = 5;

// Redis cache key prefix for block info
const REDIS_CACHE_KEY_PREFIX = 'block-info:';

/**
 * Converts a viem Block to BlockInfo format
 */
function blockToBlockInfo(block: Block | SubgraphBlockType): BlockInfo {
  if (!block.hash || !block.timestamp || !block.number) {
    throw new Error(
      `Block is missing required fields: hash=${block.hash}, timestamp=${block.timestamp}, number=${block.number}`,
    );
  }
  return {
    hash: block.hash,
    timestamp: Number(block.timestamp),
    number: Number(block.number),
    week: toWeekId(block.timestamp),
  };
}

/**
 * BlockInfoProvider abstracts away fetching block information from both
 * the subgraph (faster) and the public client (fallback).
 * It includes internal caching to avoid redundant requests.
 */
export class BlockInfoProvider {
  private cache: Map<number, BlockInfo>;
  private client: PublicClient<Transport, typeof gnosis>;
  private archiveClient: PublicClient<Transport, typeof gnosis>;
  private apiKey: string;
  private logger?: Logger;
  private blockModel: CreateModelsReturnType['blockModel'];
  private subgraphCooldownUntil: number | null = null; // Timestamp when cooldown expires
  private redisCache?: RedisCache;

  constructor(
    client: PublicClient<Transport, typeof gnosis>,
    archiveClient: PublicClient<Transport, typeof gnosis>,
    apiKey: string,
    blockModel: CreateModelsReturnType['blockModel'],
    logger?: Logger,
    redisCache?: RedisCache,
  ) {
    this.cache = new Map();
    this.client = client;
    this.archiveClient = archiveClient;
    this.apiKey = apiKey;
    this.blockModel = blockModel;
    this.logger = logger;
    this.redisCache = redisCache;
  }

  /**
   * Gets the Redis cache key for a block number
   */
  private getRedisCacheKey(blockNumber: number): string {
    return `${REDIS_CACHE_KEY_PREFIX}${blockNumber}`;
  }

  /**
   * Fetches block info from Redis cache
   */
  private async getFromRedisCache(
    blockNumber: number,
  ): Promise<BlockInfo | null> {
    if (!this.redisCache) {
      return null;
    }

    try {
      const cached = await this.redisCache.get<BlockInfo>(
        this.getRedisCacheKey(blockNumber),
      );
      return cached;
    } catch (error) {
      this.logger?.debug(
        `Error fetching block ${blockNumber} from Redis cache: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Saves block info to Redis cache (permanent, never expires)
   */
  private async saveToRedisCache(
    blockNumber: number,
    blockInfo: BlockInfo,
  ): Promise<void> {
    if (!this.redisCache) {
      return;
    }

    try {
      // Call set without TTL to store permanently (never expires)
      await this.redisCache.set(
        this.getRedisCacheKey(blockNumber),
        blockInfo,
      );
    } catch (error) {
      this.logger?.debug(
        `Error saving block ${blockNumber} to Redis cache: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Don't throw - Redis cache failures shouldn't break the flow
    }
  }

  /**
   * Fetches multiple block infos from Redis cache
   */
  private async getMultipleFromRedisCache(
    blockNumbers: number[],
  ): Promise<Map<number, BlockInfo>> {
    const result = new Map<number, BlockInfo>();

    if (!this.redisCache || blockNumbers.length === 0) {
      return result;
    }

    // Fetch all blocks from Redis in parallel
    const cachePromises = blockNumbers.map(async (blockNumber) => {
      const cached = await this.getFromRedisCache(blockNumber);
      if (cached) {
        return { blockNumber, blockInfo: cached };
      }
      return null;
    });

    const cacheResults = await Promise.all(cachePromises);

    for (const resultItem of cacheResults) {
      if (resultItem) {
        result.set(resultItem.blockNumber, resultItem.blockInfo);
        // Also populate in-memory cache
        this.cache.set(resultItem.blockNumber, resultItem.blockInfo);
      }
    }

    return result;
  }

  /**
   * Saves multiple block infos to Redis cache
   */
  private async saveMultipleToRedisCache(
    blockInfos: Map<number, BlockInfo>,
  ): Promise<void> {
    if (!this.redisCache || blockInfos.size === 0) {
      return;
    }

    // Save all blocks to Redis in parallel
    const savePromises = Array.from(blockInfos.entries()).map(
      ([blockNumber, blockInfo]) => this.saveToRedisCache(blockNumber, blockInfo),
    );

    await Promise.all(savePromises);
  }

  /**
   * Checks if subgraph is currently in cooldown period
   */
  private isSubgraphInCooldown(): boolean {
    if (this.subgraphCooldownUntil === null) {
      return false;
    }
    const now = Date.now();
    if (now >= this.subgraphCooldownUntil) {
      // Cooldown expired, clear it
      this.subgraphCooldownUntil = null;
      return false;
    }
    return true;
  }

  /**
   * Sets the subgraph cooldown period (10 minutes from now)
   */
  private setSubgraphCooldown(): void {
    this.subgraphCooldownUntil = Date.now() + SUBGRAPH_COOLDOWN_MS;
    this.logger?.warn(
      `Subgraph rate limit hit. Cooldown active for ${SUBGRAPH_COOLDOWN_MS / 1000 / 60} minutes.`,
    );
  }

  /**
   * Fetches block info from the subgraph in chunks of 500
   */
  private async fetchFromSubgraph(
    blockNumbers: number[],
  ): Promise<Map<number, BlockInfo>> {
    const result = new Map<number, BlockInfo>();

    if (blockNumbers.length === 0) {
      return result;
    }

    // Check if we're in cooldown period
    if (this.isSubgraphInCooldown()) {
      return result; // Return empty result, will fallback to RPC
    }

    // Fetch in chunks of 500
    const chunks = chunkArray(blockNumbers, 500);

    for (const chunk of chunks) {
      try {
        const subgraphBlocks = await Promise.race([
          getBlocksInfo(this.apiKey, chunk),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('Subgraph request timeout')),
              SUBGRAPH_TIMEOUT_MS,
            )
          ),
        ]);

        for (const block of subgraphBlocks) {
          const blockInfo = blockToBlockInfo(block);
          result.set(blockInfo.number, blockInfo);
          this.cache.set(blockInfo.number, blockInfo);
        }

        // Save to Redis cache
        await this.saveMultipleToRedisCache(result);
      } catch (error) {
        if (error instanceof RateLimitError) {
          // Set cooldown period
          this.setSubgraphCooldown();
          this.logger?.warn(
            `Rate limit error fetching blocks from subgraph: ${error.message}. Falling back to RPC.`,
          );
          // Stop trying subgraph and fallback to RPC for remaining blocks
          break;
        } else {
          this.logger?.verbose(`Error fetching blocks from subgraph: ${error}`);
          // Continue to next chunk, will fallback to RPC
        }
      }
    }

    return result;
  }

  /**
   * Fetches block info from the public client (RPC)
   * Uses archiveClient for older blocks (more than 100 blocks old) and client for recent blocks
   */
  private async fetchFromRpc(
    blockNumbers: number[],
  ): Promise<Map<number, BlockInfo>> {
    const result = new Map<number, BlockInfo>();

    // Get current block number once to check if blocks are too recent and to determine which client to use
    let currentBlockNumber: number | null = null;
    const getCurrentBlockNumber = async (): Promise<number> => {
      if (currentBlockNumber === null) {
        const currentBlock = await this.client.getBlockNumber();
        currentBlockNumber = Number(currentBlock);
      }
      return currentBlockNumber;
    };

    for (const blockNumber of blockNumbers) {
      try {
        const currentBlock = await getCurrentBlockNumber();

        // Check if block is ahead of current block - don't retry these
        if (blockNumber > currentBlock) {
          this.logger?.warn(
            `Block ${blockNumber} not found (ahead of current block ${currentBlock}). Block may not be mined yet.`,
          );
          continue;
        }

        // Determine which client to use based on block age
        const blockAge = currentBlock - blockNumber;
        const useArchiveClient = blockAge > ARCHIVE_BLOCK_THRESHOLD;
        const primaryClient = useArchiveClient ? this.archiveClient : this.client;
        const fallbackClient = useArchiveClient ? this.client : this.archiveClient;

        // Fetch block with retry logic
        const block = await retry(
          async (bail: (error: Error) => void, attempt: number) => {
            // On first attempt, use primary client; on retry, use fallback client
            const rpcClient = attempt === 1 ? primaryClient : fallbackClient;

            if (attempt > 1) {
              this.logger?.debug(
                `Block ${blockNumber} not found on ${useArchiveClient ? 'archive' : 'regular'} client, trying ${
                  useArchiveClient ? 'regular' : 'archive'
                } client as fallback (attempt ${attempt})`,
              );
            }

            try {
              return await Promise.race([
                rpcClient.getBlock({
                  blockNumber: BigInt(blockNumber),
                  includeTransactions: false,
                }),
                new Promise<never>((_, reject) =>
                  setTimeout(
                    () => reject(new Error('RPC request timeout')),
                    RPC_TIMEOUT_MS,
                  )
                ),
              ]);
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              const isBlockNotFound = errorMessage.includes('BlockNotFoundError') ||
                errorMessage.includes('could not be found') ||
                errorMessage.includes('not found');

              // If block not found and we've tried both clients, bail (don't retry)
              if (isBlockNotFound && attempt > 1) {
                bail(new Error(`Block ${blockNumber} not found on both clients`));
              }

              // Otherwise, throw to trigger retry
              throw error;
            }
          },
          {
            retries: 2, // Try primary client, then fallback client
            onRetry: (error: Error, attempt: number) => {
              this.logger?.debug(
                `Retrying block ${blockNumber} fetch (attempt ${attempt}): ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            },
          },
        );

        const blockInfo = blockToBlockInfo(block);
        result.set(blockInfo.number, blockInfo);
        this.cache.set(blockInfo.number, blockInfo);
        // Save to Redis cache
        await this.saveToRedisCache(blockInfo.number, blockInfo);
      } catch (error) {
        // Log error and continue with other blocks
        this.logger?.error(
          `Error fetching block ${blockNumber} from RPC: ${error instanceof Error ? error.message : String(error)}`,
        );
        console.error(error);
      }
    }

    return result;
  }

  /**
   * Gets block info for multiple blocks at once.
   * Tries subgraph first (faster), then falls back to RPC for missing blocks.
   * Uses Redis cache, then in-memory cache to avoid redundant requests.
   *
   * @param blockNumbers - Array of block numbers to fetch
   * @returns Map of block number to BlockInfo
   */
  async getBlocksInfo(blockNumbers: number[]): Promise<Map<number, BlockInfo>> {
    const result = new Map<number, BlockInfo>();

    if (blockNumbers.length === 0) {
      return result;
    }

    // First, check in-memory cache
    const uncachedBlocks: number[] = [];
    for (const blockNumber of blockNumbers) {
      const cached = this.cache.get(blockNumber);
      if (cached) {
        result.set(blockNumber, cached);
      } else {
        uncachedBlocks.push(blockNumber);
      }
    }

    // Then, check Redis cache for remaining blocks
    if (uncachedBlocks.length > 0) {
      const redisResults = await this.getMultipleFromRedisCache(uncachedBlocks);
      for (const [blockNumber, blockInfo] of redisResults) {
        result.set(blockNumber, blockInfo);
      }
    }

    // Find blocks that are still missing
    const missingBlocks = blockNumbers.filter((bn) => !result.has(bn));

    if (missingBlocks.length === 0) {
      return result;
    }

    // Try subgraph first (faster)
    const subgraphResults = await this.fetchFromSubgraph(missingBlocks);

    // Add subgraph results to final result
    for (const [blockNumber, blockInfo] of subgraphResults) {
      result.set(blockNumber, blockInfo);
    }

    // Find blocks that are still missing after subgraph
    const stillMissingBlocks = missingBlocks.filter((bn) => !result.has(bn));

    // Fallback to RPC for missing blocks
    if (stillMissingBlocks.length > 0) {
      const rpcResults = await this.fetchFromRpc(stillMissingBlocks);

      // Add RPC results to final result
      for (const [blockNumber, blockInfo] of rpcResults) {
        result.set(blockNumber, blockInfo);
      }
    }

    return result;
  }

  /**
   * Gets block info for a single block.
   * If a Block object is provided, validates it has required fields, caches it, and returns it.
   * If a block number is provided, fetches it using getBlocksInfo.
   *
   * @param blockOrBlockNumber - Either a Block object or a block number
   * @returns BlockInfo for the requested block
   */
  async getBlockInfo(blockOrBlockNumber: number | Block): Promise<BlockInfo> {
    // Check if it's a Block object (has hash, timestamp, and number properties)
    if (
      typeof blockOrBlockNumber === 'object' &&
      blockOrBlockNumber !== null &&
      'hash' in blockOrBlockNumber &&
      'timestamp' in blockOrBlockNumber &&
      'number' in blockOrBlockNumber
    ) {
      const block = blockOrBlockNumber as Block;

      // Validate required fields
      if (!block.hash || !block.timestamp || !block.number) {
        throw new Error(
          `Block is missing required fields: hash=${block.hash}, timestamp=${block.timestamp}, number=${block.number}`,
        );
      }

      // Check in-memory cache first
      const blockNumber = Number(block.number);
      const cached = this.cache.get(blockNumber);
      if (cached) {
        return cached;
      }

      // Check Redis cache
      const redisCached = await this.getFromRedisCache(blockNumber);
      if (redisCached) {
        this.cache.set(blockNumber, redisCached);
        return redisCached;
      }

      // Convert to BlockInfo and cache it
      const blockInfo = blockToBlockInfo(block);
      this.cache.set(blockInfo.number, blockInfo);
      await this.saveToRedisCache(blockInfo.number, blockInfo);
      return blockInfo;
    }

    // It's a block number, fetch it
    const blockNumber = blockOrBlockNumber as number;
    const blockInfoMap = await this.getBlocksInfo([blockNumber]);
    const blockInfo = blockInfoMap.get(blockNumber);
    if (!blockInfo) {
      throw new Error(`Block #${blockNumber} not found`, {
        cause: 'BLOCK_NOT_FOUND',
      });
    }
    return blockInfo;
  }

  /**
   * Clears the internal in-memory cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Clears Redis cache for block info (uses pattern matching)
   */
  async clearRedisCache(): Promise<void> {
    if (!this.redisCache) {
      return;
    }

    try {
      await this.redisCache.invalidatePattern(`${REDIS_CACHE_KEY_PREFIX}*`);
      this.logger?.info('Cleared Redis cache for block info');
    } catch (error) {
      this.logger?.error(
        `Error clearing Redis cache: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Gets the current cache size
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Resolves a block number from a week ID.
   * Tries multiple strategies:
   * 1. Find a block in the database for the given week
   * 2. Find a block with timestamp in the week range
   * 3. Estimate block number based on timestamp and verify it's in the correct week
   * 4. Fallback to current block if all else fails
   */
  async resolveBlockFromWeek(
    week: WeekIdFormatType,
  ): Promise<{ blockNumber: bigint; queryBlock: number }> {
    // Convert week ID to timestamp (start of week, which is a Sunday)
    const weekStartTimestamp = dayjs(week).utc().startOf('day').unix();

    // Try to find a block in the database for this week
    let blockForWeek = await this.blockModel.findOne({ week }).sort({
      number: -1,
    }).lean();

    // If no block found in DB, try to find a block with timestamp close to week start
    if (!blockForWeek) {
      // Find blocks with timestamps in the week range (week start to week start + 7 days)
      const weekEndTimestamp = weekStartTimestamp + 7 * 24 * 60 * 60;
      blockForWeek = await this.blockModel
        .findOne({
          timestamp: {
            $gte: weekStartTimestamp,
            $lte: weekEndTimestamp,
          },
        })
        .sort({ number: -1 })
        .lean();
    }

    // If still no block found, use RPC to estimate a block near the week start timestamp
    if (!blockForWeek) {
      // Estimate block number based on timestamp (Gnosis chain has ~5s block time)
      // Get current block to estimate
      const currentBlock = await this.client.getBlockNumber();
      const currentBlockInfo = await this.getBlockInfo(Number(currentBlock));
      const currentTimestamp = currentBlockInfo.timestamp;

      // Estimate blocks per second (Gnosis ~0.2 blocks/second)
      const blocksPerSecond = 0.2;
      const timeDiff = currentTimestamp - weekStartTimestamp;
      const estimatedBlockDiff = Math.floor(timeDiff * blocksPerSecond);
      const estimatedBlockNumber = Number(currentBlock) - estimatedBlockDiff;

      // Get the estimated block and verify it's in the correct week
      if (estimatedBlockNumber > 0) {
        try {
          const estimatedBlockInfo = await this.getBlockInfo(
            estimatedBlockNumber,
          );
          const estimatedWeek = toWeekId(estimatedBlockInfo.timestamp);

          // If the estimated block is in the correct week, use it
          if (estimatedWeek === week) {
            return {
              blockNumber: BigInt(estimatedBlockNumber),
              queryBlock: estimatedBlockNumber,
            };
          } else {
            // Fallback: use current block (will be associated with correct week)
            const fallbackBlock = await this.client.getBlockNumber();
            return {
              blockNumber: fallbackBlock,
              queryBlock: Number(fallbackBlock),
            };
          }
        } catch (error) {
          // If block doesn't exist, use current block
          this.logger?.warn(
            `Failed to get estimated block ${estimatedBlockNumber} for week ${week}:`,
            error,
          );
          const fallbackBlock = await this.client.getBlockNumber();
          return {
            blockNumber: fallbackBlock,
            queryBlock: Number(fallbackBlock),
          };
        }
      } else {
        // Fallback: use current block
        const fallbackBlock = await this.client.getBlockNumber();
        return {
          blockNumber: fallbackBlock,
          queryBlock: Number(fallbackBlock),
        };
      }
    }

    // Use the block found in database
    return {
      blockNumber: BigInt(blockForWeek.number),
      queryBlock: blockForWeek.number,
    };
  }

  /**
   * Gets random blocks within a week for taking snapshots at multiple points.
   * Tries to find blocks in the database first, then estimates if needed.
   */
  async getRandomBlocksFromWeek(
    week: WeekIdFormatType,
    count: number = 5,
  ): Promise<Array<{ blockNumber: bigint; queryBlock: number }>> {
    // Convert week ID to timestamp (start of week, which is a Sunday)
    const weekStartTimestamp = dayjs(week).utc().startOf('day').unix();
    const weekEndTimestamp = weekStartTimestamp + 7 * 24 * 60 * 60;

    // Try to find blocks in the database for this week
    const blocksInWeek = await this.blockModel
      .find({
        $or: [
          { week },
          {
            timestamp: {
              $gte: weekStartTimestamp,
              $lte: weekEndTimestamp,
            },
          },
        ],
      })
      .sort({ number: 1 })
      .lean();

    const result: Array<{ blockNumber: bigint; queryBlock: number }> = [];

    if (blocksInWeek.length > 0) {
      // If we have blocks in the database, randomly select up to `count` blocks
      const shuffled = [...blocksInWeek].sort(() => Math.random() - 0.5);
      const selectedBlocks = shuffled.slice(
        0,
        Math.min(count, blocksInWeek.length),
      );

      for (const block of selectedBlocks) {
        result.push({
          blockNumber: BigInt(block.number),
          queryBlock: block.number,
        });
      }
    }

    // If we don't have enough blocks from the database, estimate additional blocks
    if (result.length < count) {
      const currentBlock = await this.client.getBlockNumber();
      const currentBlockInfo = await this.getBlockInfo(Number(currentBlock));
      const currentTimestamp = currentBlockInfo.timestamp;

      // Estimate blocks per second (Gnosis ~0.2 blocks/second)
      const blocksPerSecond = 0.2;
      const timeDiff = currentTimestamp - weekStartTimestamp;
      const estimatedBlockDiff = Math.floor(timeDiff * blocksPerSecond);
      const estimatedStartBlock = Number(currentBlock) - estimatedBlockDiff;

      // Calculate block range for the week (approximately 7 days worth of blocks)
      const blocksInWeekRange = Math.floor(7 * 24 * 60 * 60 * blocksPerSecond);

      // Generate random block numbers within the estimated week range
      const needed = count - result.length;
      const existingBlockNumbers = new Set(result.map((r) => r.queryBlock));

      for (let i = 0; i < needed * 3 && result.length < count; i++) {
        // Generate a random block number within the week range
        const randomOffset = Math.floor(Math.random() * blocksInWeekRange);
        const randomBlockNumber = estimatedStartBlock + randomOffset;

        if (
          randomBlockNumber > 0 && !existingBlockNumbers.has(randomBlockNumber)
        ) {
          try {
            const blockInfo = await this.getBlockInfo(randomBlockNumber);
            const blockWeek = toWeekId(blockInfo.timestamp);

            // Verify the block is in the correct week
            if (blockWeek === week) {
              result.push({
                blockNumber: BigInt(randomBlockNumber),
                queryBlock: randomBlockNumber,
              });
              existingBlockNumbers.add(randomBlockNumber);
            }
          } catch (error) {
            // Block doesn't exist or error fetching, continue to next iteration
            this.logger?.debug(
              `Failed to get block ${randomBlockNumber} for week ${week}:`,
              error,
            );
          }
        }
      }

      // If we still don't have enough blocks, use the estimated start block as fallback
      if (result.length < count && estimatedStartBlock > 0) {
        try {
          const blockInfo = await this.getBlockInfo(estimatedStartBlock);
          const blockWeek = toWeekId(blockInfo.timestamp);
          if (
            blockWeek === week && !existingBlockNumbers.has(estimatedStartBlock)
          ) {
            result.push({
              blockNumber: BigInt(estimatedStartBlock),
              queryBlock: estimatedStartBlock,
            });
          }
        } catch (error) {
          this.logger?.debug(
            `Failed to get estimated start block ${estimatedStartBlock}:`,
            error,
          );
        }
      }
    }

    // If we still don't have enough blocks, fill with current block as fallback
    while (result.length < count) {
      const fallbackBlock = await this.client.getBlockNumber();
      const fallbackBlockNumber = Number(fallbackBlock);
      if (!result.some((r) => r.queryBlock === fallbackBlockNumber)) {
        result.push({
          blockNumber: fallbackBlock,
          queryBlock: fallbackBlockNumber,
        });
      } else {
        // If current block is already in the list, break to avoid infinite loop
        break;
      }
    }

    return result.slice(0, count);
  }

  /**
   * Calculates the estimated block range for a given week.
   * Uses the fact that Gnosis chain produces a block every 5 seconds.
   * Week range: Sunday 00:00 AM UTC to Saturday 11:59 PM UTC
   *
   * @param week - The week ID (format: YYYY-MM-DD, must be a Sunday)
   * @returns Object with estimated start and end block numbers for the week
   */
  async getWeekBlockRange(
    week: WeekIdFormatType,
  ): Promise<{ startBlock: number; endBlock: number }> {
    // Convert week ID to timestamp (start of week, which is a Sunday 00:00 AM UTC)
    const weekStartTimestamp = dayjs(week).utc().startOf('day').unix();
    // End of week is Saturday 11:59:59 PM UTC, which is Sunday 00:00 AM - 1 second
    const weekEndTimestamp = weekStartTimestamp + 7 * 24 * 60 * 60 - 1;

    // Try to find blocks in the database for this week to get actual block numbers
    const startBlockInDb = await this.blockModel
      .findOne({
        $or: [
          { week },
          {
            timestamp: {
              $gte: weekStartTimestamp,
              $lte: weekStartTimestamp + 60, // Within first minute of week
            },
          },
        ],
      })
      .sort({ number: 1 })
      .lean();

    const endBlockInDb = await this.blockModel
      .findOne({
        $or: [
          { week },
          {
            timestamp: {
              $gte: weekEndTimestamp - 60, // Within last minute of week
              $lte: weekEndTimestamp,
            },
          },
        ],
      })
      .sort({ number: -1 })
      .lean();

    // If we have both blocks in the database, use them
    if (startBlockInDb && endBlockInDb) {
      return {
        startBlock: startBlockInDb.number,
        endBlock: endBlockInDb.number,
      };
    }

    // Otherwise, estimate using current block and block time
    const currentBlock = await this.client.getBlockNumber();
    const currentBlockInfo = await this.getBlockInfo(Number(currentBlock));
    const currentTimestamp = currentBlockInfo.timestamp;

    // Calculate time difference from current to week start (in seconds)
    const timeDiffToStart = currentTimestamp - weekStartTimestamp;

    // Calculate how many blocks ago the week started
    // Divide by 5 because each block takes 5 seconds
    const blocksAgo = Math.floor(
      timeDiffToStart / GNOSIS_CHAIN_BLOCK_TIME_SECONDS,
    );

    // Estimate start block (go back in time)
    const estimatedStartBlock = Number(currentBlock) - blocksAgo;

    // Week duration: Sunday 00:00 AM to Saturday 11:59:59 PM = 7 days - 1 second
    const weekDurationSeconds = 7 * 24 * 60 * 60 - 1;
    const blocksInWeek = Math.floor(
      weekDurationSeconds / GNOSIS_CHAIN_BLOCK_TIME_SECONDS,
    );

    // End block is start block + blocks in week
    const estimatedEndBlock = estimatedStartBlock + blocksInWeek;

    // If we have one block in DB, use it and estimate the other
    if (startBlockInDb) {
      // Calculate week duration in blocks
      const weekDurationSeconds = 7 * 24 * 60 * 60 - 1; // Saturday 11:59:59 PM
      const blocksInWeek = Math.floor(
        weekDurationSeconds / GNOSIS_CHAIN_BLOCK_TIME_SECONDS,
      );
      return {
        startBlock: startBlockInDb.number,
        endBlock: startBlockInDb.number + blocksInWeek,
      };
    }

    if (endBlockInDb) {
      // Calculate week duration in blocks
      const weekDurationSeconds = 7 * 24 * 60 * 60 - 1; // Saturday 11:59:59 PM
      const blocksInWeek = Math.floor(
        weekDurationSeconds / GNOSIS_CHAIN_BLOCK_TIME_SECONDS,
      );
      return {
        startBlock: endBlockInDb.number - blocksInWeek,
        endBlock: endBlockInDb.number,
      };
    }

    // Fallback: use estimated blocks
    return {
      startBlock: Math.max(1, estimatedStartBlock),
      endBlock: Math.max(1, estimatedEndBlock),
    };
  }
}
