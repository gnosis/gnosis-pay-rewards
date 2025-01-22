process.env.TZ = 'UTC'; // Set the timezone to UTC
import './sentry.js'; // imported first to setup sentry
import { gnosisChainPublicClient as client } from './publicClient.js';
import { startIndexing, StartIndexingParamsType, startIoServers } from './core.js';
import { ENABLE_INDEXING, FETCH_BLOCK_SIZE, MONGODB_URI, RESUME_INDEXING } from './config/env.js';
import {
  createBlockModel,
  createConnection,
  createGnosisPayRewardDistributionModel,
  createGnosisPaySafeAddressModel,
  createGnosisPayTransactionModel,
  createGnosisTokenBalanceSnapshotModel,
  createTokenModel,
  createWeekCashbackRewardModel,
  createWeekMetricsSnapshotModel,
} from '@karpatkey/gnosis-pay-rewards-sdk/mongoose';
import { getLogger } from './logger.js';

async function main(resumeIndexing: boolean = RESUME_INDEXING) {
  try {
    const logger = await getLogger();

    logger.info('creating mongoose connection');

    const mongooseConnection = await createConnection(MONGODB_URI);

    mongooseConnection.set('debug', true);
    logger.info(`connected to mongodb at ${mongooseConnection.connection.host}`);

    const mongooseModels: StartIndexingParamsType['mongooseModels'] = {
      gnosisPaySafeAddressModel: createGnosisPaySafeAddressModel(mongooseConnection),
      gnosisPayTransactionModel: createGnosisPayTransactionModel(mongooseConnection),
      weekCashbackRewardModel: createWeekCashbackRewardModel(mongooseConnection),
      weekMetricsSnapshotModel: createWeekMetricsSnapshotModel(mongooseConnection),
      gnosisPayTokenModel: createTokenModel(mongooseConnection),
      blockModel: createBlockModel(mongooseConnection),
      gnosisTokenBalanceSnapshotModel: createGnosisTokenBalanceSnapshotModel(mongooseConnection),
      gnosisPayRewardDistributionModel: createGnosisPayRewardDistributionModel(mongooseConnection),
    };

    // start the I/O servers
    await startIoServers({
      client,
      mongooseModels,
      logger,
    });

    if (ENABLE_INDEXING === false) {
      console.log('Indexing is disabled');
      return;
    }

    // start the indexing process
    await startIndexing({
      client,
      fetchBlockSize: FETCH_BLOCK_SIZE,
      mongooseConnection,
      mongooseModels,
      logger,
      resumeIndexing,
    });
  } catch (e) {
    console.error(e);
  }
}

main();
