import { gnosisPayStartBlock, bigMath, gnosisPayTokens, IndexerStateAtomType } from '@karpatkey/gnosis-pay-rewards-sdk';
import {
  createGnosisPayTransactionModel,
  createTokenModel,
  saveGnosisPayTokensToDatabase,
  createMongooseLogger,
  createWeekMetricsSnapshotModel,
  createBlockModel,
  createWeekCashbackRewardModel,
  createGnosisTokenBalanceSnapshotModel,
  createGnosisPayRewardDistributionModel,
  createGnosisPaySafeAddressModel,
  createLoggerModel,
} from '@karpatkey/gnosis-pay-rewards-sdk/mongoose';
import { Mongoose } from 'mongoose';
import { atom, createStore } from 'jotai';
import { PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';

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
  handleBatchLogs,
  handleGnosisTokenTransferLogs,
  handleGnosisPayOgNftTransferLogs,
  handleGnosisPayRewardsDistributionLogs,
} from './handleLogs.js';

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
    loggerModel: ReturnType<typeof createLoggerModel>;
    blockModel: ReturnType<typeof createBlockModel>;
    gnosisTokenBalanceSnapshotModel: ReturnType<typeof createGnosisTokenBalanceSnapshotModel>;
    gnosisPayRewardDistributionModel: ReturnType<typeof createGnosisPayRewardDistributionModel>;
  };
  logger: ReturnType<typeof createMongooseLogger>;
};

export async function startIndexing({
  client,
  resumeIndexing = false,
  fetchBlockSize = 12n * 5n,
  mongooseConnection,
  mongooseModels,
  logger,
}: StartIndexingParamsType) {
  const {
    gnosisPayRewardDistributionModel,
    gnosisPaySafeAddressModel,
    gnosisPayTransactionModel,
    gnosisTokenBalanceSnapshotModel,
    weekCashbackRewardModel,
    weekMetricsSnapshotModel,
  } = mongooseModels;

  console.log('Starting indexing');

  // Initialize the latest block
  const latestBlockInitial = await client.getBlock({ includeTransactions: false });
  const fromBlockNumberInitial = gnosisPayStartBlock;
  const toBlockNumberInitial = clampToBlockRange(fromBlockNumberInitial, latestBlockInitial.number, fetchBlockSize);

  const indexerStateAtom = atom<IndexerStateAtomType>({
    startBlock: fromBlockNumberInitial,
    fetchBlockSize,
    latestBlockNumber: latestBlockInitial.number,
    distanceToLatestBlockNumber: bigMath.abs(latestBlockInitial.number - fromBlockNumberInitial),
    fromBlockNumber: fromBlockNumberInitial,
    toBlockNumber: toBlockNumberInitial,
  });
  const indexerStateStore = createStore();
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
      console.log(`Resuming indexing from ${fromBlockNumber}`);
    } else {
      console.warn(`No transactions found, starting from the beginning at block ${fromBlockNumberInitial}`);
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
    },
  });

  const restApiServer = addHttpRoutes({
    expressApp: buildExpressApp(),
    client,
    mongooseModels: {
      gnosisTokenBalanceSnapshotModel,
      gnosisPaySafeAddressModel,
      gnosisPayTransactionModel,
      weekCashbackRewardModel,
      gnosisPayRewardDistributionModel,
      weekMetricsSnapshotModel,
    },
    logger,
    getIndexerState() {
      return indexerStateStore.get(indexerStateAtom);
    },
  });

  const socketIoServer = addSocketComms({
    socketIoServer: buildSocketIoServer(restApiServer),
    gnosisPayTransactionModel,
    weekMetricsSnapshotModel,
  });

  restApiServer.listen(HTTP_SERVER_PORT, HTTP_SERVER_HOST);
  socketIoServer.listen(SOCKET_IO_SERVER_PORT);

  const apiServerUrl = `http://${HTTP_SERVER_HOST}:${HTTP_SERVER_PORT}`;
  const wsServerUrl = `ws://${HTTP_SERVER_HOST}:${SOCKET_IO_SERVER_PORT}`;

  console.log('WebSocket server available at', wsServerUrl);
  console.log('REST API server available at', apiServerUrl);

  // Index all the logs until the latest block
  while (shouldFetchLogs(getIndexerState)) {
    const { fromBlockNumber, toBlockNumber, latestBlockNumber } = getIndexerState();

    try {
      const message = `Fetching logs from ${fromBlockNumber} to ${toBlockNumber}`;
      console.log(message);
      await logger.logDebug({ message });
    } catch (e) {}

    const getLogsCommonParams = {
      client,
      fromBlock: fromBlockNumber,
      toBlock: toBlockNumber,
      verbose: true,
    };

    // Fetch all the logs
    const spendLogs = await getGnosisPaySpendLogs(getLogsCommonParams);
    const refundLogs = await getGnosisPayRefundLogs(getLogsCommonParams);
    const gnosisTokenTransferLogs = await getGnosisTokenTransferLogs(getLogsCommonParams);
    const gnosisPayRewardDistributionLogs = await getGnosisPayRewardDistributionLogs(getLogsCommonParams);
    const claimOgNftLogs = await getGnosisPayClaimOgNftLogs(getLogsCommonParams);

    try {
      const message = `Found ${spendLogs.length} spend, ${refundLogs.length} refund, ${gnosisTokenTransferLogs.length} gnosis token transfers, and ${gnosisPayRewardDistributionLogs.length} gnosis pay reward distribution logs in block ${fromBlockNumber} to ${toBlockNumber}`;
      console.log(message);
      await logger.logDebug({ message, metadata: { fromBlockNumber, toBlockNumber } });
    } catch (e) {}

    await handleBatchLogs({
      client,
      mongooseModels: {
        gnosisPayTransactionModel,
        weekCashbackRewardModel,
        weekMetricsSnapshotModel,
        gnosisPaySafeAddressModel,
        gnosisTokenBalanceSnapshotModel,
      },
      logs: [...spendLogs, ...refundLogs],
      logger,
      socketIoServer,
    });

    await handleGnosisTokenTransferLogs({
      client,
      mongooseModels: {
        gnosisPaySafeAddressModel,
        gnosisTokenBalanceSnapshotModel,
        weekCashbackRewardModel,
      },
      logs: gnosisTokenTransferLogs,
      logger,
    });

    await handleGnosisPayRewardsDistributionLogs({
      client,
      mongooseModels: {
        gnosisPayRewardDistributionModel,
        weekCashbackRewardModel,
      },
      logs: gnosisPayRewardDistributionLogs,
      logger,
    });

    await handleGnosisPayOgNftTransferLogs({
      client,
      mongooseModels: {
        gnosisPaySafeAddressModel,
      },
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

    console.log('distance to latest block', Number(distanceToLatestBlockNumber));

    // Cooldown for 20 seconds if we're within a distance of 10 blocks
    if (distanceToLatestBlockNumber <= 10n) {
      const targetBlockNumber = toBlockNumber + fetchBlockSize + 3n;

      try {
        const message = `Waiting for block ${targetBlockNumber} to continue indexing`;
        console.log(message);
        await logger.logDebug({ message });
      } catch (e) {}

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
