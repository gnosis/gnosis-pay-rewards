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

  async set<T>(key: string, data: T, ttlMs: number): Promise<void> {
    try {
      if (!this.isConnected) {
        this.logger.warn('Redis not connected, skipping cache set');
        return;
      }

      const expiresAt = Date.now() + ttlMs;
      const cacheEntry: CacheEntry<T> = { data, expiresAt };

      await this.client.setEx(
        key,
        Math.ceil(ttlMs / 1000), // Convert to seconds
        JSON.stringify(cacheEntry),
      );
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

  isHealthy(): boolean {
    return this.isConnected;
  }
}
