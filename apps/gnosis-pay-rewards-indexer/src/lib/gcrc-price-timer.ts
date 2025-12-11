import { gCrcToken, TokenPriceProvider } from '@kpk/gnosis-pay-rewards-sdk';
import { PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';
import { Logger } from 'winston';
import { RedisCache } from './redis-cache.ts';
import { retry } from './retry.ts';

const CACHE_KEY = 'gcrc-token-price:usd';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache
const FETCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches the gCRC token price and stores it in Redis cache.
 */
async function fetchAndStoreGcrcPrice(
  client: PublicClient<Transport, typeof gnosis>,
  cache: RedisCache,
  logger?: Logger,
): Promise<void> {
  try {
    const priceProvider = new TokenPriceProvider(client);
    const currentBlock = await client.getBlockNumber();

    // Fetch fresh price from CoW Protocol with retry logic
    const price = await retry(async () => await priceProvider.price({ tokenA: gCrcToken, blockNumber: currentBlock }), {
      retries: 6,
      minTimeout: 100, // Start with 100ms
      maxTimeout: 2000, // Max 2 seconds between retries
      factor: 2, // Exponential backoff
      randomize: true, // Add jitter to reduce concurrent retries
    });

    // Cache the successful price fetch
    if (price > 0) {
      await cache.set(CACHE_KEY, price, CACHE_TTL_MS).catch((error) => {
        // Silently fail cache writes - don't break the flow if cache fails
        logger?.warn('Failed to cache gCRC price', { error });
      });
      logger?.debug('Fetched and cached gCRC price', { price, blockNumber: currentBlock });
    } else {
      logger?.warn('Fetched gCRC price is 0 or negative, not caching', { price });
    }
  } catch (error) {
    // Check if error is NoLiquidity
    const errorWithBody = error as Error & { body?: { errorType?: string } };
    const isNoLiquidityError = error instanceof Error &&
      (error.message.includes('NoLiquidity') ||
        error.message.includes('no route found') ||
        errorWithBody.body?.errorType === 'NoLiquidity');

    if (isNoLiquidityError) {
      logger?.warn('No liquidity available for gCRC price fetch, skipping update');
      return;
    }

    // Log other errors but don't throw - timer will retry on next interval
    logger?.error('Failed to fetch gCRC price', { error });
  }
}

/**
 * Starts a timer that fetches and stores the gCRC token price every 5 minutes.
 * Also fetches immediately on startup.
 * @returns A function to stop the timer
 */
export function startGcrcPriceTimer(
  client: PublicClient<Transport, typeof gnosis>,
  cache: RedisCache,
  logger?: Logger,
): () => void {
  // Fetch immediately on startup
  fetchAndStoreGcrcPrice(client, cache, logger).catch((error) => {
    logger?.error('Failed to fetch gCRC price on startup', { error });
  });

  // Set up interval to fetch every 5 minutes
  const intervalId = setInterval(() => {
    fetchAndStoreGcrcPrice(client, cache, logger).catch((error) => {
      logger?.error('Failed to fetch gCRC price in timer', { error });
    });
  }, FETCH_INTERVAL_MS);

  logger?.info('Started gCRC price timer', { intervalMs: FETCH_INTERVAL_MS });

  // Return function to stop the timer
  return () => {
    clearInterval(intervalId);
    logger?.info('Stopped gCRC price timer');
  };
}

/**
 * Get the cached gCRC token price from Redis.
 * @returns The USD price of gCRC token, or null if not cached
 */
export async function getCachedGcrcPrice(cache: RedisCache): Promise<number | null> {
  return await cache.get<number>(CACHE_KEY);
}
