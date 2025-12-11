import { gCrcToken, GnoisPayTokenType, TokenFieldsType, TokenPriceProvider } from '@kpk/gnosis-pay-rewards-sdk';
import { Address, isAddressEqual, PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';
import { RedisCache } from './redis-cache.ts';
import { retry } from './retry.ts';

/**
 * Token type that can be used with CachedTokenPriceProvider.
 */
type TokenField = GnoisPayTokenType | TokenFieldsType;

/**
 * Parameters for the price method.
 */
type PriceParams = {
  tokenA: TokenField;
  tokenB?: TokenField;
  blockNumber?: bigint;
};

/**
 * Parameters for the value method.
 */
type ValueParams = {
  tokenA: TokenField;
  tokenB?: TokenField;
  blockNumber?: bigint;
  amount: number;
};

/**
 * Wrapper around TokenPriceProvider that adds Redis caching for gCRC token prices.
 * Handles NoLiquidity errors by falling back to cached prices.
 */
export class CachedTokenPriceProvider {
  private priceProvider: TokenPriceProvider;
  private cache: RedisCache;
  private readonly CACHE_KEY = 'token-price:gcrc:usd';
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

  constructor(client: PublicClient<Transport, typeof gnosis>, cache: RedisCache) {
    this.priceProvider = new TokenPriceProvider(client);
    this.cache = cache;
  }

  /**
   * Get the USD price of a token (overload for positional parameters).
   */
  async price(token: TokenField, blockNumber?: bigint): Promise<number>;
  /**
   * Get the price of tokenA, defaulting to USD if tokenB is not provided (overload for object parameter).
   */
  async price(params: PriceParams): Promise<number>;
  async price(tokenOrParams: TokenField | PriceParams, blockNumber?: bigint): Promise<number> {
    // Check if it's a PriceParams object (has tokenA property)
    if (typeof tokenOrParams === 'object' && 'tokenA' in tokenOrParams) {
      const params = tokenOrParams as PriceParams;
      const { tokenA, tokenB, blockNumber: paramBlockNumber } = params;

      // If tokenB is not provided, default to USD (using USDC as reference)
      if (!tokenB) {
        return await this.getPriceWithCache(tokenA, paramBlockNumber);
      }

      // Get prices for both tokens
      const priceA = await this.getPriceWithCache(tokenA, paramBlockNumber);
      const priceB = await this.getPriceWithCache(tokenB, paramBlockNumber);

      if (priceB === 0) {
        throw new Error(`Token ${tokenB.symbol} has a price of 0, cannot calculate ratio`);
      }

      return priceA / priceB;
    }

    // Handle positional parameters (token, blockNumber?)
    const token = tokenOrParams as TokenField;
    return await this.getPriceWithCache(token, blockNumber);
  }

  /**
   * Get the value of an amount of tokenA in terms of tokenB (or USD if tokenB is not provided).
   */
  async value(params: ValueParams): Promise<number> {
    const { tokenA, tokenB, blockNumber, amount } = params;

    // Get the price ratio
    const price = await this.price({ tokenA, tokenB, blockNumber });

    return amount * price;
  }

  /**
   * Internal method to get price with caching for gCRC token.
   * For other tokens, delegates to the underlying TokenPriceProvider.
   */
  private async getPriceWithCache(token: TokenField, blockNumber?: bigint): Promise<number> {
    // Only cache gCRC token prices
    if (!isAddressEqual(token.address as Address, gCrcToken.address)) {
      // For non-gCRC tokens, still use retry logic
      return await retry(
        async () => await this.priceProvider.price(token, blockNumber),
        {
          retries: 3,
          minTimeout: 100, // Start with 100ms
          maxTimeout: 2000, // Max 2 seconds between retries
          factor: 2, // Exponential backoff
          randomize: true, // Add jitter to reduce concurrent retries
        },
      );
    }

    // Try to get cached price first
    const cachedPrice = await this.cache.get<number>(this.CACHE_KEY);
    if (cachedPrice !== null && cachedPrice > 0) {
      return cachedPrice;
    }

    try {
      // Fetch fresh price from CoW Protocol with retry logic
      const price = await retry(
        async () => await this.priceProvider.price(token, blockNumber),
        {
          retries: 6,
          minTimeout: 100, // Start with 100ms
          maxTimeout: 2000, // Max 2 seconds between retries
          factor: 2, // Exponential backoff
          randomize: true, // Add jitter to reduce concurrent retries
        },
      );

      // Cache the successful price fetch
      if (price > 0) {
        await this.cache.set(this.CACHE_KEY, price, this.CACHE_TTL_MS).catch(() => {
          // Silently fail cache writes - don't break the flow if cache fails
        });
      }

      return price;
    } catch (error) {
      // Check if error is NoLiquidity
      const errorWithBody = error as Error & { body?: { errorType?: string } };
      const isNoLiquidityError = error instanceof Error &&
        (error.message.includes('NoLiquidity') ||
          error.message.includes('no route found') ||
          errorWithBody.body?.errorType === 'NoLiquidity');

      if (isNoLiquidityError) {
        // Fall back to cached price if available
        const fallbackPrice = await this.cache.get<number>(this.CACHE_KEY);
        if (fallbackPrice !== null && fallbackPrice > 0) {
          return fallbackPrice;
        }
      }

      // Re-throw if we can't fall back to cache
      throw error;
    }
  }
}
