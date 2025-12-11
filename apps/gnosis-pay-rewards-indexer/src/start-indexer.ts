import { createConnection, createModels } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import type { PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';
import type { Logger } from 'winston';
import { gnosisChainArchiveClient as archiveClient, gnosisChainPublicClient as client } from './public-client.ts';
import { startIndexer, StartIndexerParamsType } from './core.ts';
import {
  FETCH_BLOCK_SIZE,
  INDEXER_ENABLE_CONSOLE_LOGGER,
  MONGODB_DEBUG,
  MONGODB_URI,
  REDIS_URL,
  RESUME_INDEXING,
  THE_GRAPH_API_KEY,
} from './config/env.ts';
import { getLogger } from './logger.ts';
import { IndexerState } from './lib/indexer-state.ts';
import { BlockInfoProvider } from './lib/block-info-provider.ts';
import { createIndexerCheckpointModel, loadIndexerCheckpoint } from './lib/indexer-checkpoint.ts';
import { RedisCache } from './lib/redis-cache.ts';
import type { IndexerCheckpointModelType } from './lib/indexer-checkpoint.ts';

type InitializeIndexerWithCheckpointParamsType = {
  indexerId: string;
  defaultStartBlock: number;
  fetchBlockSize: number;
  indexerCheckpointModel: IndexerCheckpointModelType;
  client: PublicClient<Transport, typeof gnosis>;
  logger: Logger;
  resumeIndexing: boolean;
  redisCache: RedisCache;
};

/**
 * Initialize an indexer with checkpoint support
 */
export async function initializeIndexerWithCheckpoint(params: InitializeIndexerWithCheckpointParamsType) {
  const { indexerId, fetchBlockSize, indexerCheckpointModel, client, logger, resumeIndexing, redisCache } = params;

  let startBlock = params.defaultStartBlock;

  if (resumeIndexing === true) {
    const checkpoint = await loadIndexerCheckpoint(
      indexerCheckpointModel,
      indexerId,
    );
    if (checkpoint !== null) {
      startBlock = checkpoint + 1; // Resume from the block after the last processed one
      logger.info(
        `resuming indexer ${indexerId} from checkpoint block ${startBlock}`,
      );
    }
  }

  return IndexerState.initialize({
    id: indexerId,
    client,
    fetchBlockSize,
    startBlock,
    logger,
    redisCache,
  });
}

/**
 * Entry point for a single indexer process
 * This runs in a separate child process
 *
 * Usage: deno run -A start-indexer.ts <indexerId> <startBlock>
 * Example: deno run -A start-indexer.ts full-index-to-head 1000000
 */
async function main() {
  const args = Deno.args;
  if (args.length < 2) {
    console.error('Usage: deno run -A src/start-indexer.ts <indexerId> <startBlock>');
    Deno.exit(1);
  }

  const indexerId = args[0];
  const defaultStartBlock = parseInt(args[1], 10);

  if (isNaN(defaultStartBlock)) {
    console.error('Invalid startBlock:', args[1]);
    Deno.exit(1);
  }

  try {
    const logger = await getLogger();
    logger.info('Starting indexer process', { indexerId, defaultStartBlock });

    const mongooseConnection = await createConnection(MONGODB_URI);
    mongooseConnection.set('debug', MONGODB_DEBUG);

    logger.info(`connected to mongodb at ${mongooseConnection.connection.host}`);

    const mongooseModels = createModels(mongooseConnection);
    const indexerCheckpointModel = createIndexerCheckpointModel(mongooseConnection);

    const redisCache = new RedisCache({ logger, url: REDIS_URL });

    try {
      await redisCache.connect();
    } catch (error) {
      logger.error('Error connecting to cache', { error });
      throw error;
    }

    const indexerState = await initializeIndexerWithCheckpoint({
      indexerId,
      defaultStartBlock,
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

    const startIndexerParams: StartIndexerParamsType = {
      client,
      archiveClient,
      mongooseModels,
      blockInfoProvider,
      indexerCheckpointModel,
      redisCache,
      indexerState,
      logger: INDEXER_ENABLE_CONSOLE_LOGGER === true ? logger.child({ indexerId }) : undefined,
    };

    // Setup graceful shutdown handlers
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down indexer...`);
      try {
        await indexerState.unregisterIndexerId(logger);
        await mongooseConnection.disconnect();
        await redisCache.disconnect();
      } catch (error) {
        logger.error('Error during shutdown cleanup', { error });
      }
      Deno.exit(0);
    };

    Deno.addSignalListener('SIGINT', () => shutdown('SIGINT'));
    Deno.addSignalListener('SIGTERM', () => shutdown('SIGTERM'));

    // Start the indexer (this runs indefinitely)
    await startIndexer(startIndexerParams);
  } catch (e) {
    console.error(`Indexer ${indexerId} process error:`, e);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
