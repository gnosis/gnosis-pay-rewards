import { gnoToken, type IndexerStateType, payoutSafes } from '@kpk/gnosis-pay-rewards-sdk';
import { type CreateModelsReturnType } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import { Logger } from 'winston';
import { retry } from './lib/retry.ts';
import { createHttpServer } from './http-server.ts';
import { waitForBlock } from './lib/wait-for-block.ts';

import { getGnosisPaySpendLogs } from './gp/getGnosisPaySpendLogs.ts';
import { getGnosisPayRefundLogs } from './gp/getGnosisPayRefundLogs.ts';
import { getTokenTransferLogs } from './gp/getTokenTransferLogs.ts';
import { getGnosisPayClaimOgNftLogs } from './gp/getGnosisPayClaimOgNftLogs.ts';
import {
  handleGnosisPayOgNftTransferLogs,
  handleGnosisPayRewardsDistributionLogs,
  handleGnosisTokenTransferLogs,
  handleRefundLogs,
  handleSpendLogs,
} from './handleLogs.ts';
import type { IndexerState } from './lib/indexer-state.ts';
import type { GnosisChainPublicClient } from './process/types.ts';
import type { RedisCache } from './lib/redis-cache.ts';
import type { BlockInfoProvider } from './lib/block-info-provider.ts';
import { runRangePostProcessingOperations } from './process/block-range-post-actions.ts';
import { buildRetryOptions } from './gp/commons.ts';
import { handleSaveBlock } from './process/save-block.ts';
import { IndexerCheckpointModelType, saveIndexerCheckpoint } from './lib/indexer-checkpoint.ts';

type BaseParamsType = {
  client: GnosisChainPublicClient;
  redisCache: RedisCache;
  mongooseModels: CreateModelsReturnType;
  logger?: Logger;
  blockInfoProvider: BlockInfoProvider;
};

type HandleRangeParamsType = BaseParamsType & {
  range: IndexerStateType['range'];
  indexerState: IndexerState;
  indexerCheckpointModel: IndexerCheckpointModelType;
};

export type StartIndexerParamsType = BaseParamsType & {
  archiveClient: GnosisChainPublicClient;
  indexerState: IndexerState;
  indexerCheckpointModel: IndexerCheckpointModelType;
};
export type StartServersParamsType = BaseParamsType & {
  getIndexerStates: () => Promise<IndexerStateType[]>;
  http: {
    port: number;
    hostname: string;
  };
};

/**
 * Start the I/O HTTP server,
 * @param client - the client to use for the servers
 * @param mongooseModels - the mongoose models to use for the servers
 * @param logger - the logger to use for the servers
 * @returns the rest API server and the socket.io server
 */
export async function startIoServers(params: StartServersParamsType) {
  const {
    logger,
    http,
  } = params;

  const restApiServer = createHttpServer(params);

  await restApiServer.listen({ port: http.port, hostname: http.hostname });

  const apiServerUrl = `http://${http.hostname}:${http.port}`;

  const serverInfoMessage = `REST API server available at ${apiServerUrl}`;

  if (logger) {
    logger.info(serverInfoMessage);
  } else {
    console.log(serverInfoMessage);
  }

  return {
    restApiServer,
  };
}

/**
 * Start the indexing process
 * @param client - the client to use for the indexing
 * @param fetchBlockSize - the size of the block range to fetch
 * @param mongooseConnection - the mongoose connection to use for the indexing
 * @param mongooseModels - the mongoose models to use for the indexing
 * @param logger - the logger to use for the indexing
 */
export async function startIndexer(params: StartIndexerParamsType) {
  const {
    archiveClient,
    client,
    mongooseModels,
    logger,
    indexerState,
    blockInfoProvider,
    indexerCheckpointModel,
  } = params;

  logger?.info('starting indexing', {
    initialState: indexerState.toJSON(),
  });

  // Watch for new blocks with automatic restart on error
  let unwatchBlocks: (() => void) | undefined;

  const startBlockWatcher = () => {
    // Clean up existing watcher if any
    if (unwatchBlocks) {
      try {
        unwatchBlocks();
      } catch (error) {
        logger?.warn('Error cleaning up previous block watcher', { error });
      }
    }

    try {
      unwatchBlocks = client.watchBlocks({
        includeTransactions: false,
        onBlock(block) {
          try {
            indexerState.updateLatestBlockNumber(block.number, logger);

            // Save the block database
            retry(
              async () => {
                await handleSaveBlock(
                  { mongooseModels, blockInfoProvider },
                  block,
                );
              },
              buildRetryOptions({
                name: 'handleSaveBlock',
                verbose: true,
                retries: 3,
              }),
            );
          } catch (error) {
            // Handle validation errors (e.g., chain reorganization)
            logger?.warn('Error updating latest block number', {
              error: error instanceof Error ? error.message : String(error),
              blockNumber: block.number?.toString(),
            });
            // Don't restart watcher for validation errors, just log and continue
          }
        },
        onError(error) {
          logger?.error(
            'error in public client watchBlocks, will restart watcher',
            { error },
          );
          // Restart the watcher after a short delay
          setTimeout(() => {
            logger?.info('restarting block watcher after error');
            startBlockWatcher();
          }, 5000); // Wait 5 seconds before restarting
        },
      });
    } catch (error) {
      logger?.error('Failed to start block watcher, will retry', { error });
      // Retry after a delay
      setTimeout(() => {
        startBlockWatcher();
      }, 5000);
    }
  };

  // Start the block watcher
  startBlockWatcher();

  // Index all the logs until the latest block
  while (indexerState.shouldFetchLogs()) {
    const stateBeforeLoop = indexerState.getState();
    logger?.debug('indexer loop iteration', {
      indexerId: indexerState.toJSON().id,
      range: stateBeforeLoop.range,
      latestBlock: stateBeforeLoop.latestBlock,
      shouldFetchLogs: indexerState.shouldFetchLogs(),
    });
    const { range } = indexerState.getState();

    try {
      await handleRange({
        ...params,
        client: archiveClient,
        range,
        indexerState,
        blockInfoProvider,
        indexerCheckpointModel,
      });
    } catch (error) {
      logger?.error('Error handling range, will continue to next range', {
        error: error instanceof Error ? error.message : String(error),
        range,
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Continue to next range instead of crashing
      // Move to next range to avoid getting stuck on the same range
      const FOLLOWING_MODE_THRESHOLD = 10;
      const FOLLOWING_BLOCK_SIZE = 10;
      const { distanceToLatestBlock } = indexerState.getState();
      const isFollowingMode = distanceToLatestBlock <= FOLLOWING_MODE_THRESHOLD;
      indexerState.moveToNextBlockRange({
        logger,
        blockSize: isFollowingMode ? FOLLOWING_BLOCK_SIZE : undefined,
      });
      continue;
    }

    // When close to the head, switch to following mode with smaller block sizes
    // This allows the indexer to follow the chain head efficiently instead of waiting hours
    const FOLLOWING_MODE_THRESHOLD = 10; // Switch to following mode when within 10 blocks of head
    const FOLLOWING_BLOCK_SIZE = 10; // Process 20 blocks at a time when following the head

    const { distanceToLatestBlock } = indexerState.getState();
    const isFollowingMode = distanceToLatestBlock <= FOLLOWING_MODE_THRESHOLD;

    // Move to the next block range, using smaller block size in following mode
    indexerState.moveToNextBlockRange({
      logger,
      blockSize: isFollowingMode ? FOLLOWING_BLOCK_SIZE : undefined,
    });

    // Save checkpoint after successfully processing a range
    const { range: currentRange } = indexerState.getState();
    const indexerId = indexerState.toJSON().id;
    try {
      await saveIndexerCheckpoint(
        indexerCheckpointModel,
        indexerId,
        currentRange.toBlock,
      );
      logger?.debug('saved indexer checkpoint', {
        indexerId,
        lastProcessedBlock: currentRange.toBlock,
      });
    } catch (error) {
      logger?.warn('failed to save indexer checkpoint', {
        indexerId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - checkpoint saving failure shouldn't stop indexing
    }

    if (isFollowingMode) {
      // In following mode, wait for just a few blocks instead of the full fetchBlockSize
      const { range: nextRange } = indexerState.getState();
      const targetBlockNumber = nextRange.toBlock + FOLLOWING_BLOCK_SIZE;

      logger?.info(
        `following head: waiting for block ${targetBlockNumber} to continue indexing`,
        {
          operation: 'waitForBlock',
          targetBlockNumber,
          mode: 'following',
          followingBlockSize: FOLLOWING_BLOCK_SIZE,
        },
      );

      try {
        await waitForBlock({
          client,
          blockNumber: BigInt(targetBlockNumber),
          timeoutMs: 10 * 60 * 1000, // 10 minutes timeout for following mode
        });
      } catch (error) {
        logger?.error(
          'Error waiting for block, will check if we can continue',
          {
            error: error instanceof Error ? error.message : String(error),
            targetBlockNumber,
          },
        );
        // Check current latest block - maybe we can continue without waiting
        try {
          const currentLatestBlock = await client.getBlockNumber();
          indexerState.updateLatestBlockNumber(currentLatestBlock, logger);
          // If we're still behind, continue the loop which will try again
          // If we've caught up, the loop will exit naturally
        } catch (getBlockError) {
          logger?.error(
            'Failed to get current block number after waitForBlock error',
            {
              error: getBlockError instanceof Error ? getBlockError.message : String(getBlockError),
            },
          );
          // Wait a bit before retrying to avoid tight loop
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    }
  }

  // Log why the indexer stopped
  const finalState = indexerState.getState();
  logger?.info('indexer stopped', {
    indexerId: indexerState.toJSON().id,
    reason: 'shouldFetchLogs returned false',
    finalState: {
      range: finalState.range,
      latestBlock: finalState.latestBlock,
      shouldFetchLogs: indexerState.shouldFetchLogs(),
    },
  });

  // Clean up block watcher
  if (unwatchBlocks) {
    try {
      unwatchBlocks();
    } catch (error) {
      logger?.warn('Error cleaning up block watcher', { error });
    }
  }

  // Unregister indexer ID from active indexers set
  try {
    await indexerState.unregisterIndexerId(logger);
  } catch (error) {
    logger?.warn('Error unregistering indexer ID', { error });
  }
}

async function handleRange(
  params: HandleRangeParamsType,
) {
  const {
    client,
    mongooseModels,
    logger,
    range,
    indexerState,
    blockInfoProvider,
    redisCache,
  } = params;
  const startTime = Date.now();
  const rangeLogger = logger?.child({
    operation: 'fetchLogs',
    range,
  });

  const getLogsCommonParams = {
    client,
    fromBlock: BigInt(range.fromBlock),
    toBlock: BigInt(range.toBlock),
    verbose: true,
  };

  rangeLogger?.info(
    `fetching logs from ${range.fromBlock} to ${range.toBlock}`,
  );

  // Fetch all the logs
  const spendLogs = await getGnosisPaySpendLogs(getLogsCommonParams);
  const refundLogs = await getGnosisPayRefundLogs(getLogsCommonParams);
  const gnosisTokenTransferLogs = await getTokenTransferLogs(
    getLogsCommonParams,
  );
  const gnosisPayRewardDistributionLogs = await getTokenTransferLogs({
    ...getLogsCommonParams,
    address: gnoToken.address,
    from: [payoutSafes.gnosisPay],
  });
  const metriRewardDistributionLogs = await getTokenTransferLogs({
    ...getLogsCommonParams,
    address: gnoToken.address,
    from: payoutSafes.metri,
  });
  const claimOgNftLogs = await getGnosisPayClaimOgNftLogs(getLogsCommonParams);

  const logsCount = {
    spendLogs: spendLogs.length,
    refundLogs: refundLogs.length,
    gnosisTokenTransferLogs: gnosisTokenTransferLogs.length,
    gnosisPayRewardDistributionLogs: gnosisPayRewardDistributionLogs.length,
    metriRewardDistributionLogs: metriRewardDistributionLogs.length,
    claimOgNftLogs: claimOgNftLogs.length,
  };

  rangeLogger?.info('logs fetched', { logsCount });

  // Process other handlers synchronously
  const logHandlers = [
    { handler: handleSpendLogs, logs: spendLogs, name: 'spend' },
    { handler: handleRefundLogs, logs: refundLogs, name: 'refund' },
    {
      handler: handleGnosisPayRewardsDistributionLogs,
      logs: gnosisPayRewardDistributionLogs,
      name: 'gnosisPayRewardDistribution',
    },
    {
      handler: handleGnosisPayRewardsDistributionLogs,
      logs: metriRewardDistributionLogs,
      name: 'metriRewardDistribution',
    },
    {
      handler: handleGnosisPayOgNftTransferLogs,
      logs: claimOgNftLogs,
      name: 'ogNftClaim',
    },
  ];

  for (const { handler, logs } of logHandlers) {
    await handler({
      client,
      mongooseModels,
      logs: logs as never,
      logger,
      blockInfoProvider,
      redisCache,
    });
  }

  // Start GNO token transfer handler asynchronously (fire and forget)
  handleGnosisTokenTransferLogs({
    client,
    mongooseModels,
    logs: gnosisTokenTransferLogs,
    logger,
    blockInfoProvider,
    redisCache,
  });

  // Run post-processing operations asynchronously (fire and forget)
  // This includes checking for missing token snapshots, taking token prices, and saving blocks
  // Blocks are saved incrementally so the indexer can resume from the latest saved block
  runRangePostProcessingOperations({
    ...range,
    client,
    mongooseModels,
    logger,
    blockInfoProvider,
    redisCache,
  })
    .then(() => {
      rangeLogger?.debug('completed post-processing operations', { range });
    })
    .catch((error) => {
      rangeLogger?.error('error in post-processing operations', {
        error,
        range,
      });
    });

  // Calculate processing time and update average
  const endTime = Date.now();
  const processingTimeSeconds = (endTime - startTime) / 1000;
  indexerState.updateAverageProcessingTime(processingTimeSeconds, logger);

  const state = indexerState.getState();
  const estimatedTimeToChainHead = state.estimates?.timeToHeadSec;
  const estimatedTimeFormatted = estimatedTimeToChainHead
    ? `${(estimatedTimeToChainHead / 60).toFixed(2)} minutes (${(estimatedTimeToChainHead / 3600).toFixed(2)} hours)`
    : 'N/A';

  rangeLogger?.info(
    `range processed in ${processingTimeSeconds.toFixed(2)} seconds`,
    {
      processingTimeSeconds: Math.round(processingTimeSeconds * 100) / 100,
      averageProcessingTimeSeconds: state.processing?.avgTimeSec
        ? Math.round((state.processing.avgTimeSec as number) * 100) / 100
        : undefined,
      estimatedTimeToChainHeadSeconds: estimatedTimeToChainHead,
      estimatedTimeToChainHeadFormatted: estimatedTimeFormatted,
      distanceToLatestBlock: state.distanceToLatestBlock,
      syncPercentage: state.syncPct,
    },
  );
}
