// Polyfill Node.js globals before any imports that might need them
import './polyfill-node-globals.ts';

import type { IndexerStateType } from '@kpk/gnosis-pay-rewards-sdk';
import { gnosisChainPublicClient as client } from './public-client.ts';
import { startIoServers } from './core.ts';
import {
  HTTP_SERVER_HOSTNAME,
  HTTP_SERVER_PORT,
  MONGODB_DEBUG,
  MONGODB_URI,
  REDIS_URL,
  THE_GRAPH_API_KEY,
} from './config/env.ts';
import { createConnection, createModels } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import { getLogger } from './logger.ts';
import { BlockInfoProvider } from './lib/block-info-provider.ts';
import { RedisCache } from './lib/redis-cache.ts';
import { IndexerState } from './lib/indexer-state.ts';
import { startGcrcPriceTimer } from './lib/gcrc-price-timer.ts';

/**
 * Entry point for the HTTP server process
 * This runs in a separate child process from the indexers
 */
async function main() {
  try {
    const logger = await getLogger();
    logger.info('Starting HTTP server process');

    const mongooseConnection = await createConnection(MONGODB_URI);
    mongooseConnection.set('debug', MONGODB_DEBUG);

    logger.info(`connected to mongodb at ${mongooseConnection.connection.host}`);

    const mongooseModels = createModels(mongooseConnection);
    const redisCache = new RedisCache({ logger, url: REDIS_URL });

    try {
      await redisCache.connect();
    } catch (error) {
      logger.error('Error connecting to cache', { error });
      throw error;
    }

    const blockInfoProvider = new BlockInfoProvider(
      client,
      client, // Use same client for archive in server process
      THE_GRAPH_API_KEY,
      mongooseModels.blockModel,
      logger,
      redisCache,
    );

    // Create a function that reads indexer states from Redis
    // Indexers update their state to Redis in real-time
    const getIndexerStates = async (): Promise<IndexerStateType[]> => {
      try {
        // Get active indexer IDs from Redis set (no scanning needed)
        const activeIndexerIds = await redisCache.sMembers(IndexerState.getActiveIndexerIdsKey());

        if (activeIndexerIds.length === 0) {
          logger?.debug('No active indexers found');
          return [];
        }

        // Construct Redis keys directly from indexer IDs
        const redisKeys = activeIndexerIds.map(
          (id) => IndexerState.createRedisKey(id),
        );

        // Use MGET to fetch all values at once instead of individual GET calls
        const redisValues = await redisCache.mget<IndexerStateType>(redisKeys);

        // Filter out null values
        const states: IndexerStateType[] = [];
        for (let i = 0; i < redisValues.length; i++) {
          const state = redisValues[i];
          if (state) {
            states.push(state);
          } else {
            logger?.warn('Indexer state not found in Redis', { key: redisKeys[i], indexerId: activeIndexerIds[i] });
          }
        }

        return states;
      } catch (error) {
        logger?.error('Error getting indexer states from Redis', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        return [];
      }
    };

    // Start the gCRC price timer (fetches price every 5 minutes)
    startGcrcPriceTimer(client, redisCache, logger);

    // Start the HTTP server
    await startIoServers({
      client,
      mongooseModels,
      logger,
      blockInfoProvider,
      http: {
        port: HTTP_SERVER_PORT,
        hostname: HTTP_SERVER_HOSTNAME,
      },
      redisCache,
      getIndexerStates,
    });

    logger.info('HTTP server process started successfully');
  } catch (e) {
    console.error('HTTP server process error:', e);
    Deno.exit(1);
  }
}

main();
