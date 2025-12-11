import { gnosisChainArchiveClient as archiveClient, gnosisChainPublicClient as client } from './public-client.ts';
import { startIndexer, StartIndexerParamsType, startIoServers } from './core.ts';
import {
  ENABLE_INDEXING,
  FETCH_BLOCK_SIZE,
  HTTP_SERVER_HOSTNAME,
  HTTP_SERVER_PORT,
  INDEXER_ENABLE_CONSOLE_LOGGER,
  MONGODB_DEBUG,
  MONGODB_URI,
  REDIS_URL,
  RESUME_INDEXING,
  THE_GRAPH_API_KEY,
} from './config/env.ts';
import { gnosisPayTokens, tokenBalanceSnapshotTokens } from '@kpk/gnosis-pay-rewards-sdk';
import { createConnection, createModels, saveTokensToDatabase } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import { getLogger } from './logger.ts';
import { BlockInfoProvider } from './lib/block-info-provider.ts';
import { createIndexerCheckpointModel } from './lib/indexer-checkpoint.ts';
import { RedisCache } from './lib/redis-cache.ts';
import { NOV_2025_INDEXER_ID, NOV_2025_START_BLOCK, OLD_INDEXER_ID, OLD_INDEXER_START_BLOCK } from './constants.ts';
import { initializeIndexerWithCheckpoint } from './start-indexer.ts';

async function main() {
  try {
    const logger = await getLogger();

    const mongooseConnection = await createConnection(MONGODB_URI);

    mongooseConnection.set('debug', MONGODB_DEBUG);

    logger.info(
      `connected to mongodb at ${mongooseConnection.connection.host}`,
    );

    const mongooseModels = createModels(mongooseConnection);
    const indexerCheckpointModel = createIndexerCheckpointModel(
      mongooseConnection,
    );

    const redisCache = new RedisCache({ logger, url: REDIS_URL });

    try {
      await redisCache.connect();
    } catch (error) {
      logger.error('Error connecting to cache', { error });
      throw error;
    }

    // Save the Gnosis Pay tokens and token balance snapshot tokens to the database
    await saveTokensToDatabase(mongooseModels.tokenModel, [
      ...gnosisPayTokens,
      ...tokenBalanceSnapshotTokens,
    ]);

    // Initialize indexers with checkpoint support
    const oldIndexerState = await initializeIndexerWithCheckpoint({
      indexerId: OLD_INDEXER_ID,
      defaultStartBlock: OLD_INDEXER_START_BLOCK,
      fetchBlockSize: FETCH_BLOCK_SIZE,
      indexerCheckpointModel,
      client,
      logger,
      resumeIndexing: RESUME_INDEXING,
      redisCache,
    });

    const indexerStateQ42025 = await initializeIndexerWithCheckpoint({
      indexerId: NOV_2025_INDEXER_ID,
      defaultStartBlock: NOV_2025_START_BLOCK,
      fetchBlockSize: FETCH_BLOCK_SIZE,
      indexerCheckpointModel,
      client,
      logger,
      resumeIndexing: RESUME_INDEXING,
      redisCache,
    });

    const blockInfoProvider = new BlockInfoProvider(
      client,
      archiveClient,
      THE_GRAPH_API_KEY,
      mongooseModels.blockModel,
      logger,
      redisCache,
    );

    const indexerStates = [oldIndexerState, indexerStateQ42025];
    const startIndexerParams: Omit<StartIndexerParamsType, 'indexerState'> = {
      client,
      archiveClient,
      mongooseModels,
      blockInfoProvider,
      indexerCheckpointModel,
      redisCache,
    };

    // start the I/O servers
    startIoServers({
      client,
      mongooseModels,
      logger,
      blockInfoProvider,
      getIndexerStates: () => {
        return Promise.resolve(indexerStates.map((indexerState) => indexerState.toJSON()));
      },
      http: {
        port: HTTP_SERVER_PORT,
        hostname: HTTP_SERVER_HOSTNAME,
      },
      redisCache,
    });

    if (ENABLE_INDEXING === false) {
      console.log(
        'Indexing is disabled. Set ENABLE_INDEXING=true to enable indexing',
      );
      return;
    }

    // Start all indexers concurrently with proper error handling
    const indexerPromises = indexerStates.map((indexerState) => {
      return startIndexer({
        ...startIndexerParams,
        indexerState,
        logger: INDEXER_ENABLE_CONSOLE_LOGGER === true
          ? logger.child({
            indexerId: indexerState.toJSON().id,
          })
          : undefined,
      }).catch((error) => {
        logger.error('Indexer failed with error', {
          indexerId: indexerState.toJSON().id,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      });
    });

    // Wait for all indexers to start (they run indefinitely, so this will only catch initial errors)
    await Promise.all(indexerPromises);
  } catch (e) {
    console.error(e);
  }
}

main();
