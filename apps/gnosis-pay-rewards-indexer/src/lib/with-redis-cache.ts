/* eslint-disable @typescript-eslint/no-explicit-any */
import type { RedisCache } from './redis-cache.ts';

type WithRedisCacheOptions<TArgs extends any[]> = {
  redisCache: RedisCache;
  cacheKeyGenerator: (...args: TArgs) => string;
  cacheDuration?: number; // in milliseconds, undefined means no expiry
};

/**
 * Higher-order function that wraps a function with Redis caching.
 *
 * @param fn - The function to wrap with caching
 * @param options - Configuration options for caching
 * @returns A cached version of the function
 *
 * @example
 * ```ts
 * const getGnosisPaySafeFromMetriSafeWithCache = withRedisCache(
 *   getGnosisPaySafeFromMetriSafe,
 *   {
 *     redisCache,
 *     cacheKeyGenerator: (metriSafeAddress) => `gnosis-pay-safe-from-metri:${metriSafeAddress.toLowerCase()}`,
 *     cacheDuration: 24 * 60 * 60 * 1000, // 24 hours
 *   }
 * );
 * ```
 */
export function withRedisCache<TArgs extends any[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options: WithRedisCacheOptions<TArgs>,
): (...args: TArgs) => Promise<TReturn> {
  const { redisCache, cacheKeyGenerator, cacheDuration } = options;

  return async (...args: TArgs): Promise<TReturn> => {
    const cacheKey = cacheKeyGenerator(...args);

    // Check cache first
    const cached = await redisCache.get<TReturn>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // If not in cache, call the original function
    const result = await fn(...args);

    // Cache the result
    await redisCache.set(cacheKey, result, cacheDuration);

    return result;
  };
}
