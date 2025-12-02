import {
  gnosisPayStartBlock,
  gnosisPayTokens,
  gnoToken,
  IndexerStateAtomType,
} from '@karpatkey/gnosis-pay-rewards-sdk';
import {
  createGnosisPayTransactionModel,
  createTokenModel,
  saveGnosisPayTokensToDatabase,
  createWeekMetricsSnapshotModel,
  createBlockModel,
  createWeekCashbackRewardModel,
  createGnosisTokenBalanceSnapshotModel,
  createGnosisPayRewardDistributionModel,
  createGnosisPaySafeAddressModel,
  GnosisPayTokenPriceModelType,
} from '@karpatkey/gnosis-pay-rewards-sdk/mongoose';
import { Mongoose } from 'mongoose';
import { PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';
import { Logger } from 'winston';

import { buildSocketIoServer, buildExpressApp } from './server.js';
import { SOCKET_IO_SERVER_PORT, HTTP_SERVER_HOST, HTTP_SERVER_PORT, REDIS_URL, TOKEN_PRICE_SNAPSHOT_BLOCK_INTERVAL, GNOSIS_TOKEN_SNAPSHOT_BLOCK_INTERVAL } from './config/env.js';
import { waitForBlock } from './waitForBlock.js';

import { addHttpRoutes } from './addHttpRoutes.js';
import { addSocketComms } from './addSocketComms.js';
import { getGnosisPaySpendLogs } from './gp/getGnosisPaySpendLogs.js';
import { getGnosisPayRefundLogs } from './gp/getGnosisPayRefundLogs.js';
import { getGnosisTokenTransferLogs } from './gp/getGnosisTokenTransferLogs.js';
import { getGnosisPayRewardDistributionLogs } from './gp/getGnosisPayRewardDistributionLogs.js';
import { getGnosisPayClaimOgNftLogs } from './gp/getGnosisPayClaimOgNftLogs.js';
import {
  handleSpendLogs,
  handleGnosisTokenTransferLogs,
  handleGnosisPayOgNftTransferLogs,
  handleGnosisPayRewardsDistributionLogs,
  handleRefundLogs,
} from './handleLogs.js';
import { handleBlock } from './handleBlock.js';
import {
  getIndexerState,
  initializeIndexerState,
  moveToNextBlockRange,
  updateLatestBlockNumber,
} from './indexer-state.js';
import { GnosisChainPublicClient } from './process/types.js';
import { RedisCache } from './cache.js';

export type StartIndexingParamsType = {
  client: PublicClient<Transport, typeof gnosis>;
  /**
   * If true, the indexer will resume indexing from the latest pending reward in the database.
   * If the database is empty, the indexer will start indexing from the Gnosis Pay start block.
   * See {@link gnosisPayStartBlock} for the start block.
   */
  readonly resumeIndexing?: boolean;
  readonly fetchBlockSize?: bigint;
  mongooseConnection: Mongoose;
  mongooseModels: {
    gnosisPaySafeAddressModel: ReturnType<typeof createGnosisPaySafeAddressModel>;
    gnosisPayTransactionModel: ReturnType<typeof createGnosisPayTransactionModel>;
    weekCashbackRewardModel: ReturnType<typeof createWeekCashbackRewardModel>;
    weekMetricsSnapshotModel: ReturnType<typeof createWeekMetricsSnapshotModel>;
    gnosisPayTokenModel: ReturnType<typeof createTokenModel>;
    gnosisPayTokenPriceModel: GnosisPayTokenPriceModelType;
    blockModel: ReturnType<typeof createBlockModel>;
    gnosisTokenBalanceSnapshotModel: ReturnType<typeof createGnosisTokenBalanceSnapshotModel>;
    gnosisPayRewardDistributionModel: ReturnType<typeof createGnosisPayRewardDistributionModel>;
  };
  logger: Logger;
};

type StartServersParamsType = {
  client: PublicClient<Transport, typeof gnosis>;
  mongooseModels: StartIndexingParamsType['mongooseModels'];
  logger: Logger;
};

/**
 * Start the I/O HTTP and WebSocket servers,
 * ports are defined in {@link HTTP_SERVER_PORT} and {@link SOCKET_IO_SERVER_PORT}
 * @param client - the client to use for the servers
 * @param mongooseModels - the mongoose models to use for the servers
 * @param logger - the logger to use for the servers
 * @returns the rest API server and the socket.io server
 */
export async function startIoServers({ client, mongooseModels, logger }: StartServersParamsType) {
  // Initialize cache (Redis with fallback to in-memory)
  const cache = new RedisCache({ logger, url: REDIS_URL });

  try {
    await cache.connect();
  } catch (error) {
    logger.error('Error connecting to cache', { error });
    throw error;
  }

  const restApiServer = addHttpRoutes({
    expressApp: buildExpressApp(),
    client,
    mongooseModels,
    getIndexerState,
    logger,
    cache,
  });

  const socketIoServer = addSocketComms({
    socketIoServer: buildSocketIoServer(restApiServer),
    mongooseModels,
  });

  restApiServer.listen(HTTP_SERVER_PORT, HTTP_SERVER_HOST);
  socketIoServer.listen(SOCKET_IO_SERVER_PORT);

  const apiServerUrl = `http://${HTTP_SERVER_HOST}:${HTTP_SERVER_PORT}`;
  const wsServerUrl = `ws://${HTTP_SERVER_HOST}:${SOCKET_IO_SERVER_PORT}`;

  logger.info(`WebSocket server available at ${wsServerUrl}`);
  logger.info(`REST API server available at ${apiServerUrl}`);

  return {
    restApiServer,
    socketIoServer,
  };
}

/**
 * Start the indexing process
 * @param client - the client to use for the indexing
 * @param resumeIndexing - if true, the indexer will resume indexing from the latest pending reward in the database
 * @param fetchBlockSize - the size of the block range to fetch
 * @param mongooseConnection - the mongoose connection to use for the indexing
 * @param mongooseModels - the mongoose models to use for the indexing
 * @param logger - the logger to use for the indexing
 */
export async function startIndexing({
  client,
  resumeIndexing = false,
  fetchBlockSize = 12n * 5n,
  mongooseConnection,
  mongooseModels,
  logger,
}: StartIndexingParamsType) {
  logger.info(`starting indexing batch size of ${fetchBlockSize}, resumeIndexing: ${resumeIndexing}`);

  // Anchor the indexing to the Gnosis Pay start block
  let fromBlockNumberInitial = gnosisPayStartBlock;

  // When resuming indexing, we need to find the latest Gnosis Pay transaction in the database
  if (resumeIndexing === true) {
    const [latestGnosisPayTransaction] = await mongooseModels.gnosisPayTransactionModel
      .find()
      .sort({ blockNumber: -1 })
      .limit(1);

    if (latestGnosisPayTransaction !== undefined) {
      fromBlockNumberInitial = BigInt(latestGnosisPayTransaction.blockNumber) - 1n;
      logger.info(`resuming indexing from block ${fromBlockNumberInitial}`);
    } else {
      logger.info(
        `no transactions found to resume indexing, starting from the beginning at block ${fromBlockNumberInitial}`,
      );
    }
  } else {
    const session = await mongooseConnection.startSession();
    // Clean up the database
    await session.withTransaction(async () => {
      for (const modelName of mongooseConnection.modelNames()) {
        await mongooseConnection.model(modelName).deleteMany();
      }
    });
    await session.commitTransaction();
    await session.endSession();
    // Save the Gnosis Pay tokens to the database
    await saveGnosisPayTokensToDatabase(mongooseModels.gnosisPayTokenModel, [...gnosisPayTokens, gnoToken]);
  }

  // Initialize the indexer state
  await initializeIndexerState(client, fetchBlockSize, fromBlockNumberInitial, logger);

  // Watch for new blocks
  client.watchBlocks({
    includeTransactions: false,
    onBlock(block) {
      updateLatestBlockNumber(block.number, logger);

      handleBlock({
        blockNumber: block.number,
        client,
        logger,
        mongooseModels,
      });
    },
    onError(error) {
      logger.error('error in public client watchBlocks', { error });
    },
  });

  // Index all the logs until the latest block
  while (shouldFetchLogs(getIndexerState())) {
    const { range } = getIndexerState();

    const rangeStartTime = Date.now();
    // logger.info(`RANGE_START: ${range.fromBlockNumber} to ${range.toBlockNumber}`);

    await handleRange({
      client,
      mongooseModels,
      logger,
      range,
    });

    const rangeEndTime = Date.now();
    const rangeDuration = rangeEndTime - rangeStartTime;
    const durationSeconds = (rangeDuration / 1000).toFixed(2);
    logger.info(
      `RANGE_END: ${range.fromBlockNumber} to ${range.toBlockNumber} - Duration: ${durationSeconds}s (${rangeDuration}ms)`,
    );

    // Move to the next block range
    const { distanceToLatestBlockNumber } = getIndexerState();

    moveToNextBlockRange(logger);

    // Wait for the next block if we're within a distance of 10 blocks
    if (distanceToLatestBlockNumber <= 10n) {
      const targetBlockNumber = range.toBlockNumber + fetchBlockSize + 10n;

      logger.info(`waiting for block ${targetBlockNumber} to continue indexing`, {
        operation: 'waitForBlock',
        targetBlockNumber,
      });

      await waitForBlock({
        client,
        blockNumber: targetBlockNumber,
      });
    }
  }
}

async function handleRange({
  client,
  mongooseModels,
  logger,
  range,
}: {
  client: GnosisChainPublicClient;
  mongooseModels: StartIndexingParamsType['mongooseModels'];
  range: IndexerStateAtomType['range'];
  logger: Logger;
}) {
  const scopeLogger = logger.child({
    operation: 'fetchLogs',
    range,
  });

  const getLogsCommonParams = {
    client,
    fromBlock: range.fromBlockNumber,
    toBlock: range.toBlockNumber,
    verbose: true,
  };

  scopeLogger.info(`fetching logs from ${range.fromBlockNumber} to ${range.toBlockNumber}`);

  // Fetch all the logs
  const fetchLogsStart = Date.now();
  const [spendLogs, refundLogs, gnosisTokenTransferLogs, gnosisPayRewardDistributionLogs, claimOgNftLogs] = 
  await Promise.all([
    getGnosisPaySpendLogs(getLogsCommonParams),
    getGnosisPayRefundLogs(getLogsCommonParams),
    getGnosisTokenTransferLogs(getLogsCommonParams),
    getGnosisPayRewardDistributionLogs(getLogsCommonParams),
    getGnosisPayClaimOgNftLogs(getLogsCommonParams),
  ]);
  const fetchLogsDuration = Date.now() - fetchLogsStart;

  const totalLogs = 
    spendLogs.length + 
    refundLogs.length + 
    gnosisTokenTransferLogs.length + 
    gnosisPayRewardDistributionLogs.length + 
    claimOgNftLogs.length;

  logger.info(
    `RANGE_LOGS: ${range.fromBlockNumber} to ${range.toBlockNumber} - Total: ${totalLogs} logs (spend:${spendLogs.length}, refund:${refundLogs.length}, transfer:${gnosisTokenTransferLogs.length}, reward:${gnosisPayRewardDistributionLogs.length}, nft:${claimOgNftLogs.length})`,
  );

  scopeLogger.debug(`found ${spendLogs.length} spend logs`, {
    logsType: 'spendLogs',
  });
  scopeLogger.debug(`found ${refundLogs.length} refund logs`, {
    logsType: 'refundLogs',
  });
  scopeLogger.debug(`found ${gnosisTokenTransferLogs.length} gnosis token transfer logs`, {
    logsType: 'gnosisTokenTransferLogs',
  });
  scopeLogger.debug(`found ${gnosisPayRewardDistributionLogs.length} gnosis pay reward distribution logs`, {
    logsType: 'gnosisPayRewardDistributionLogs',
  });
  scopeLogger.debug(`found ${claimOgNftLogs.length} claim og nft logs`, {
    logsType: 'claimOgNftLogs',
  });

  const processLogsStart = Date.now();
  await handleSpendLogs({
    client,
    mongooseModels,
    logs: spendLogs,
    logger,
  });

  await handleRefundLogs({
    client,
    mongooseModels,
    logs: refundLogs,
    logger,
  });

  await handleGnosisTokenTransferLogs({
    client,
    mongooseModels,
    logs: gnosisTokenTransferLogs,
    logger,
  });

  await handleGnosisPayRewardsDistributionLogs({
    client,
    mongooseModels,
    logs: gnosisPayRewardDistributionLogs,
    logger,
  });

  await handleGnosisPayOgNftTransferLogs({
    client,
    mongooseModels,
    logs: claimOgNftLogs,
    logger,
  });
  const processLogsDuration = Date.now() - processLogsStart;

  // Among the block range, we need to record the token prices
  const handleBlocksStart = Date.now();
  const blocksToProcess: bigint[] = [];
  for (let blockNumber = range.fromBlockNumber; blockNumber <= range.toBlockNumber; blockNumber++) {
    if (
      BigInt(blockNumber) % GNOSIS_TOKEN_SNAPSHOT_BLOCK_INTERVAL === 0n ||
      BigInt(blockNumber) % TOKEN_PRICE_SNAPSHOT_BLOCK_INTERVAL === 0n
    ) {
      blocksToProcess.push(blockNumber);
    }
  }

  for (const blockNumber of blocksToProcess) {
    await handleBlock({ blockNumber, client, mongooseModels, logger });
  }
  const handleBlocksDuration = Date.now() - handleBlocksStart;

  // Log timing breakdown
  logger.info(
    `RANGE_TIMING: ${range.fromBlockNumber} to ${range.toBlockNumber} - Fetch: ${(fetchLogsDuration / 1000).toFixed(2)}s, Process: ${(processLogsDuration / 1000).toFixed(2)}s, Blocks: ${(handleBlocksDuration / 1000).toFixed(2)}s (${blocksToProcess.length} blocks)`,
  );
}

/**
 * Check if the indexer should fetch logs
 * @param state - the indexer state
 * @returns true if the indexer should fetch logs, false otherwise
 */
function shouldFetchLogs(state: IndexerStateAtomType) {
  const { range, latestBlockNumber } = state;

  const should = range.toBlockNumber <= latestBlockNumber;

  return should;
}
