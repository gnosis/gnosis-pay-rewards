import type { RedisCache } from '../lib/redis-cache.ts';
import type { Context } from '@oak/oak';
import { returnOakErrorResponse, returnOakSuccessResponse } from '@kpk/apps-sdk/server';
import { createApiErrorResponseBody } from '@kpk/apps-sdk/api';

type WithCacheOptions = {
  errorCode?: string;
  errorMessage?: string;
};

// Generic cache wrapper function
export async function withCache<T>(
  cache: RedisCache,
  cacheKey: string,
  cacheDuration: number,
  ctx: Context,
  dataFetcher: () => Promise<T>,
  options?: WithCacheOptions,
): Promise<void> {
  try {
    // Check if response is in cache
    const cachedEntry = await cache.getEntry<T>(cacheKey);

    if (cachedEntry) {
      const expiresAt = cachedEntry.expiresAt;
      const timeToExpiry = Math.max(
        0,
        Math.floor((expiresAt - Date.now()) / 1000),
      );

      // Set cache headers
      ctx.response.headers.set(
        'Cache-Control',
        `public, max-age=${timeToExpiry}`,
      );
      ctx.response.headers.set('Expires', new Date(expiresAt).toUTCString());

      const cacheMeta = {
        hit: true,
        expireAt: expiresAt,
        ttl: timeToExpiry,
        source: 'redis' as const,
      };

      // Check if response already has data and meta structure (from createApiSuccessResponseBody)
      if (
        cachedEntry.data &&
        typeof cachedEntry.data === 'object' &&
        'data' in cachedEntry.data &&
        'meta' in cachedEntry.data
      ) {
        const response = cachedEntry.data as {
          data: unknown;
          meta: { status: number; cache?: unknown };
        };
        returnOakSuccessResponse(ctx, {
          ...response,
          meta: {
            ...response.meta,
            cache: cacheMeta,
          },
        });
      } else {
        // Otherwise, wrap it in a response structure
        returnOakSuccessResponse(ctx, {
          data: cachedEntry.data,
          meta: {
            status: 200,
            cache: cacheMeta,
          },
        });
      }
      return;
    }

    // Fetch fresh data
    const response = await dataFetcher();
    const expiresAt = Date.now() + cacheDuration;
    const ttl = Math.floor(cacheDuration / 1000);

    // Cache the data (without cache metadata)
    await cache.set(cacheKey, response, cacheDuration);

    // Set cache headers
    ctx.response.headers.set('Cache-Control', `public, max-age=${ttl}`);
    ctx.response.headers.set('Expires', new Date(expiresAt).toUTCString());

    const cacheMeta = {
      hit: false,
      expireAt: expiresAt,
      ttl: ttl,
      source: 'redis' as const,
    };

    // Check if response already has data and meta structure (from createApiSuccessResponseBody)
    if (
      response && typeof response === 'object' && 'data' in response &&
      'meta' in response
    ) {
      const responseWithMeta = response as {
        data: unknown;
        meta: { status: number; cache?: unknown };
      };
      returnOakSuccessResponse(ctx, {
        ...responseWithMeta,
        meta: {
          ...responseWithMeta.meta,
          cache: cacheMeta,
        },
      });
    } else {
      // Otherwise, wrap it in a response structure
      returnOakSuccessResponse(ctx, {
        data: response,
        meta: {
          status: 200,
          cache: cacheMeta,
        },
      });
    }
  } catch (error) {
    returnOakErrorResponse(
      ctx,
      createApiErrorResponseBody({ status: 500 }, [
        {
          message: options?.errorMessage || 'Failed to fetch data',
          code: options?.errorCode || 'CACHE_ERROR',
          details: error instanceof Error ? [error] : undefined,
        },
      ]),
    );
  }
}
