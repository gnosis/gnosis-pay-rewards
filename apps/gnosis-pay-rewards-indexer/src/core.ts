import { gnosisPayStartBlock, bigMath, gnosisPayTokens, IndexerStateAtomType } from '@karpatkey/gnosis-pay-rewards-sdk';
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
} from '@karpatkey/gnosis-pay-rewards-sdk/mongoose';
import { Mongoose } from 'mongoose';
import { atom, createStore } from 'jotai';
import { PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';
import { Logger } from 'winston';

import { clampToBlockRange } from './utils.js';
import { buildSocketIoServer, buildExpressApp } from './server.js';
import { SOCKET_IO_SERVER_PORT, HTTP_SERVER_HOST, HTTP_SERVER_PORT } from './config/env.js';
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
 * Atom for the indexer state with default values
 */
const indexerStateAtom = atom<IndexerStateAtomType>({
  startBlock: 0n,
  fetchBlockSize: 12n * 5n,
  latestBlockNumber: 0n,
  distanceToLatestBlockNumber: 0n,
  fromBlockNumber: 0n,
  toBlockNumber: 0n,
});

/**
 * Store for the indexer state
 */
const indexerStateStore = createStore();

/**
 * Start the I/O HTTP and WebSocket servers,
 * ports are defined in {@link HTTP_SERVER_PORT} and {@link SOCKET_IO_SERVER_PORT}
 * @param client - the client to use for the servers
 * @param mongooseModels - the mongoose models to use for the servers
 * @param logger - the logger to use for the servers
 * @returns the rest API server and the socket.io server
 */
export async function startIoServers({ client, mongooseModels, logger }: StartServersParamsType) {
  const restApiServer = addHttpRoutes({
    expressApp: buildExpressApp(),
    client,
    mongooseModels,
    getIndexerState() {
      return indexerStateStore.get(indexerStateAtom);
    },
    logger,
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
  logger.debug('starting indexing');

  // Initialize the latest block
  const latestBlockInitial = await client.getBlock({ includeTransactions: false });
  const fromBlockNumberInitial = gnosisPayStartBlock;
  const toBlockNumberInitial = clampToBlockRange(fromBlockNumberInitial, latestBlockInitial.number, fetchBlockSize);

  indexerStateStore.set(indexerStateAtom, {
    startBlock: fromBlockNumberInitial,
    fetchBlockSize,
    latestBlockNumber: latestBlockInitial.number,
    distanceToLatestBlockNumber: bigMath.abs(latestBlockInitial.number - fromBlockNumberInitial),
    fromBlockNumber: fromBlockNumberInitial,
    toBlockNumber: toBlockNumberInitial,
  });
  const getIndexerState = () => indexerStateStore.get(indexerStateAtom);

  if (resumeIndexing === true) {
    const [latestGnosisPayTransaction] = await mongooseModels.gnosisPayTransactionModel
      .find()
      .sort({ blockNumber: -1 })
      .limit(1);

    if (latestGnosisPayTransaction !== undefined) {
      const fromBlockNumber = BigInt(latestGnosisPayTransaction.blockNumber) - 1n;
      const toBlockNumber = clampToBlockRange(fromBlockNumber, latestBlockInitial.number, fetchBlockSize);

      indexerStateStore.set(indexerStateAtom, (prev) => ({
        ...prev,
        startBlock: fromBlockNumber,
        distanceToLatestBlockNumber: bigMath.abs(latestBlockInitial.number - fromBlockNumber),
        fromBlockNumber,
        toBlockNumber,
      }));
      logger.info(`resuming indexing from block ${fromBlockNumber}`);
    } else {
      logger.info(`no transactions found, starting from the beginning at block ${fromBlockNumberInitial}`);
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
    await saveGnosisPayTokensToDatabase(mongooseModels.gnosisPayTokenModel, gnosisPayTokens);
  }

  // Watch for new blocks
  client.watchBlocks({
    includeTransactions: false,
    onBlock(block) {
      indexerStateStore.set(indexerStateAtom, (prev) => ({
        ...prev,
        latestBlockNumber: block.number,
      }));

      handleBlock({ block, client, logger, mongooseModels });
    },
  });

  // Index all the logs until the latest block
  while (shouldFetchLogs(getIndexerState)) {
    const { fromBlockNumber, toBlockNumber, latestBlockNumber } = getIndexerState();

    const range = {
      fromBlock: fromBlockNumber,
      toBlock: toBlockNumber,
    };

    const getLogsCommonParams = {
      client,
      ...range,
      verbose: true,
    };

    logger.info(`fetching logs from ${fromBlockNumber} to ${toBlockNumber}`, {
      operation: 'fetchLogs',
      range,
    });
    // Fetch all the logs
    const spendLogs = await getGnosisPaySpendLogs(getLogsCommonParams);
    const refundLogs = await getGnosisPayRefundLogs(getLogsCommonParams);
    const gnosisTokenTransferLogs = await getGnosisTokenTransferLogs(getLogsCommonParams);
    const gnosisPayRewardDistributionLogs = await getGnosisPayRewardDistributionLogs(getLogsCommonParams);
    const claimOgNftLogs = await getGnosisPayClaimOgNftLogs(getLogsCommonParams);

    logger.info(`found ${spendLogs.length} spend logs`, {
      logId: 'spendLogs',
      operation: 'fetchLogs',
      range,
    });
    logger.info(`found ${refundLogs.length} refund logs`, {
      logId: 'refundLogs',
      operation: 'fetchLogs',
      range,
    });
    logger.info(`found ${gnosisTokenTransferLogs.length} gnosis token transfer logs`, {
      logId: 'gnosisTokenTransferLogs',
      operation: 'fetchLogs',
      range,
    });
    logger.info(`found ${gnosisPayRewardDistributionLogs.length} gnosis pay reward distribution logs`, {
      logId: 'gnosisPayRewardDistributionLogs',
      operation: 'fetchLogs',
      range,
    });
    logger.info(`found ${claimOgNftLogs.length} claim og nft logs`, {
      logId: 'claimOgNftLogs',
      operation: 'fetchLogs',
      range,
    });

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

    // Move to the next block range
    const nextFromBlockNumber = fromBlockNumber + fetchBlockSize;
    const nextToBlockNumber = clampToBlockRange(nextFromBlockNumber, latestBlockNumber, fetchBlockSize);
    // Sanity check to make sure we're not going too fast
    const distanceToLatestBlockNumber = bigMath.abs(nextToBlockNumber - latestBlockNumber);

    indexerStateStore.set(indexerStateAtom, (prev) => ({
      ...prev,
      fromBlockNumber: nextFromBlockNumber,
      distanceToLatestBlockNumber,
      toBlockNumber: nextToBlockNumber,
    }));

    logger.debug(`distance to latest block: ${Number(distanceToLatestBlockNumber)}`);

    // Cooldown for 20 seconds if we're within a distance of 10 blocks
    if (distanceToLatestBlockNumber <= 10n) {
      const targetBlockNumber = toBlockNumber + fetchBlockSize + 3n;

      logger.info(`waiting for block ${targetBlockNumber} to continue indexing`, {
        targetBlockNumber,
      });

      await waitForBlock({
        client,
        blockNumber: targetBlockNumber,
      });
    }
  }
}

function shouldFetchLogs(getIndexerState: () => IndexerStateAtomType) {
  const { toBlockNumber, latestBlockNumber } = getIndexerState();

  return toBlockNumber <= latestBlockNumber;
}
