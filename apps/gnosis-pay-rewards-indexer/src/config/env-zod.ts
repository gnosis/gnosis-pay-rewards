import { z } from 'zod';

export const envZodSchema = z
  .object({
    // Required variables
    JSON_RPC_PROVIDER_GNOSIS: z.string().url(),
    WEBSOCKET_JSON_RPC_PROVIDER_GNOSIS: z.string().optional(),
    ARCHIVE_JSON_RPC_PROVIDER_GNOSIS: z.string().url(),
    SENTRY_DSN: z.string().optional(),
    MONGODB_URI: z.string().min(1),
    REDIS_URL: z.string().url(),
    NODE_ENV: z.enum(['development', 'production', 'test']).default(
      'development',
    ),
    IS_DOCKER: z
      .string()
      .transform((val) => val === 'true')
      .default('false'),
    HTTP_SERVER_PORT: z.coerce.number().default(3000),
    HTTP_SERVER_HOSTNAME: z.string().default('0.0.0.0'),
    MONGODB_DEBUG: z
      .string()
      .transform((val) => val === 'true')
      .default('false'),
    LOGGER_MONGODB_TRANSPORT_ENABLED: z
      .string()
      .transform((val) => val.toLowerCase() === 'true')
      .default('false'),
    LOGGER_MONGODB_TRANSPORT_URI: z.string().url().optional(),
    LOGGER_FILE_TRANSPORT_ENABLED: z
      .string()
      .transform((val) => val.toLowerCase() === 'true')
      .default('false'),
    LOGGER_FILE_TRANSPORT_DIR: z.string().default('logs'),
    LOGGER_FILE_TRANSPORT_FILENAME: z.string().default('app-%DATE%.log'),
    LOGGER_FILE_TRANSPORT_MAX_SIZE: z.string().default('20m'),
    LOGGER_FILE_TRANSPORT_MAX_FILES: z.string().default('14d'),
    /**
     * Whether to resume indexing from the last block number
     */
    RESUME_INDEXING: z
      .string()
      .transform((val) => val.toLowerCase() === 'true')
      .default('false'),
    /**
     * How many blocks to fetch at a time
     */
    FETCH_BLOCK_SIZE: z.coerce.number().default(2000),
    /**
     * How many blocks to wait before taking a snapshot of the Gnosis token balances
     */
    GNOSIS_TOKEN_SNAPSHOT_BLOCK_INTERVAL: z.coerce.number().default(25_000),
    /**
     * How many blocks to wait before recording the token price
     */
    TOKEN_PRICE_SNAPSHOT_BLOCK_INTERVAL: z.coerce.number().default(720), // ~1 hour at 5 seconds per block
    ENABLE_INDEXING: z
      .string()
      .transform((val) => val.toLowerCase() === 'true')
      .default('false'),

    THE_GRAPH_API_KEY: z.string(),

    INDEXER_ENABLE_CONSOLE_LOGGER: z.string().transform((val) => val.toLowerCase() === 'true').default('false'),
  })
  .refine(
    (data) => {
      if (data.LOGGER_MONGODB_TRANSPORT_ENABLED === true) {
        return data.LOGGER_MONGODB_TRANSPORT_URI !== undefined;
      }

      return true;
    },
    {
      path: ['LOGGER_MONGODB_TRANSPORT_URI'],
      message: 'LOGGER_MONGODB_TRANSPORT_URI is required when LOGGER_MONGODB_TRANSPORT_ENABLED is true',
    },
  );
