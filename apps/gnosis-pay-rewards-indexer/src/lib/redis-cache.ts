import { createClient, RedisClientType } from 'redis';
import { Logger } from 'winston';

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

type RedisCacheParamsType = {
  logger: Logger;
  url: string;
};

export class RedisCache {
  private client: RedisClientType;
  private logger: Logger;
  private isConnected = false;

  constructor({ logger, url }: RedisCacheParamsType) {
    this.logger = logger;
    this.client = createClient({
      url,
    });

    this.client.on('error', (err) => {
      this.logger.error('Redis Client Error:', err);
      this.isConnected = false;
    });

    this.client.on('connect', () => {
      this.logger.info('Redis client connected');
      this.isConnected = true;
    });

    this.client.on('disconnect', () => {
      this.logger.warn('Redis client disconnected');
      this.isConnected = false;
    });
  }

  async connect(): Promise<void> {
    if (!this.isConnected) {
      await this.client.connect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.disconnect();
    }
  }

  async set<T>(key: string, data: T, ttlMs?: number): Promise<void> {
    try {
      if (!this.isConnected) {
        this.logger.warn('Redis not connected, skipping cache set');
        return;
      }

      const expiresAt = ttlMs ? Date.now() + ttlMs : Number.MAX_SAFE_INTEGER;
      const cacheEntry: CacheEntry<T> = { data, expiresAt };

      if (ttlMs !== undefined) {
        // Use setEx when TTL is provided
        await this.client.setEx(
          key,
          Math.ceil(ttlMs / 1000), // Convert to seconds
          JSON.stringify(cacheEntry),
        );
      } else {
        // Use set (no expiration) when TTL is not provided
        await this.client.set(key, JSON.stringify(cacheEntry));
      }
    } catch (error) {
      this.logger.error('Redis set error:', error);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      if (!this.isConnected) {
        this.logger.warn('Redis not connected, skipping cache get');
        return null;
      }

      const cached = await this.client.get(key);
      if (!cached) {
        return null;
      }

      const entry: CacheEntry<T> = JSON.parse(cached);

      // Check if expired
      if (Date.now() > entry.expiresAt) {
        await this.client.del(key);
        return null;
      }

      return entry.data;
    } catch (error) {
      this.logger.error('Redis get error:', error);
      return null;
    }
  }

  /**
   * Get all keys matching a pattern
   * @param pattern - Redis key pattern (e.g., "indexer:state:*")
   * @returns Array of matching keys
   */
  async getKeys(pattern: string): Promise<string[]> {
    try {
      if (!this.isConnected) {
        this.logger.warn('Redis not connected, skipping getKeys');
        return [];
      }

      const keys: string[] = [];
      for await (
        const key of this.client.scanIterator({
          MATCH: pattern,
          COUNT: 100,
        })
      ) {
        keys.push(key);
      }

      return keys;
    } catch (error) {
      this.logger.error('Redis getKeys error:', error);
      return [];
    }
  }

  /**
   * Get multiple values at once using MGET
   * @param keys - Array of Redis keys
   * @returns Array of values (null for missing keys)
   */
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    try {
      if (!this.isConnected) {
        this.logger.warn('Redis not connected, skipping mget');
        return keys.map(() => null);
      }

      if (keys.length === 0) {
        return [];
      }

      const values = await this.client.mGet(keys);
      return values.map((cached) => {
        if (!cached) {
          return null;
        }

        try {
          const entry: CacheEntry<T> = JSON.parse(cached);
          // Check if expired
          if (Date.now() > entry.expiresAt) {
            return null;
          }
          return entry.data;
        } catch (error) {
          this.logger.error('Redis mget parse error:', error);
          return null;
        }
      });
    } catch (error) {
      this.logger.error('Redis mget error:', error);
      return keys.map(() => null);
    }
  }

  async getEntry<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      if (!this.isConnected) {
        this.logger.warn('Redis not connected, skipping cache getEntry');
        return null;
      }

      const cached = await this.client.get(key);
      if (!cached) {
        return null;
      }

      const entry: CacheEntry<T> = JSON.parse(cached);

      // Check if expired
      if (Date.now() > entry.expiresAt) {
        await this.client.del(key);
        return null;
      }

      return entry;
    } catch (error) {
      this.logger.error('Redis getEntry error:', error);
      return null;
    }
  }

  async del(key: string): Promise<void> {
    try {
      if (!this.isConnected) {
        return;
      }

      await this.client.del(key);
    } catch (error) {
      this.logger.error('Redis delete error:', error);
    }
  }

  async clear(): Promise<void> {
    try {
      if (!this.isConnected) {
        return;
      }

      await this.client.flushDb();
    } catch (error) {
      this.logger.error('Redis clear error:', error);
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    try {
      if (!this.isConnected) {
        return;
      }

      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
    } catch (error) {
      this.logger.error('Redis pattern invalidation error:', error);
    }
  }

  /**
   * Add member(s) to a Redis set
   * @param key - Redis set key
   * @param members - Member(s) to add
   */
  async sAdd(key: string, ...members: string[]): Promise<void> {
    try {
      if (!this.isConnected) {
        this.logger.warn('Redis not connected, skipping sAdd');
        return;
      }

      await this.client.sAdd(key, members);
    } catch (error) {
      this.logger.error('Redis sAdd error:', error);
    }
  }

  /**
   * Get all members of a Redis set
   * @param key - Redis set key
   * @returns Array of set members
   */
  async sMembers(key: string): Promise<string[]> {
    try {
      if (!this.isConnected) {
        this.logger.warn('Redis not connected, skipping sMembers');
        return [];
      }

      return await this.client.sMembers(key);
    } catch (error) {
      this.logger.error('Redis sMembers error:', error);
      return [];
    }
  }

  /**
   * Remove member(s) from a Redis set
   * @param key - Redis set key
   * @param members - Member(s) to remove
   */
  async sRem(key: string, ...members: string[]): Promise<void> {
    try {
      if (!this.isConnected) {
        this.logger.warn('Redis not connected, skipping sRem');
        return;
      }

      await this.client.sRem(key, members);
    } catch (error) {
      this.logger.error('Redis sRem error:', error);
    }
  }

  isHealthy(): boolean {
    return this.isConnected;
  }
}
