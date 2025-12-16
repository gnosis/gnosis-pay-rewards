import { config } from 'dotenv';
import { z } from 'zod';

// Load the config
config();

const env = process.env;

// Load the .env.development file in development mode
if (env.NODE_ENV === 'development') {
  config({ path: '.env.development' });
}

const envSchema = z
  .object({
    // Required variables
    JSON_RPC_PROVIDER_GNOSIS: z.string().url(),
    WEBSOCKET_JSON_RPC_PROVIDER_GNOSIS: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
    MONGODB_URI: z.string().min(1),
    REDIS_URL: z.string().url(),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    IS_DOCKER: z
      .string()
      .transform((val) => val === 'true')
      .default('false'),
    HTTP_SERVER_PORT: z.coerce.number().default(3000),
    HTTP_SERVER_HOST: z.string().default('0.0.0.0'),
    SOCKET_IO_SERVER_PORT: z.coerce.number().default(4000),
    MONGODB_DEBUG: z
      .string()
      .transform((val) => val === 'true')
      .default('false'),
    LOGGER_MONGODB_TRANSPORT_ENABLED: z
      .string()
      .transform((val) => val.toLowerCase() === 'true')
      .default('false'),
    LOGGER_MONGODB_TRANSPORT_URI: z.string().url().optional(),
    /**
     * Whether to resume indexing from the last block number
     */
    RESUME_INDEXING: z
      .string()
      .transform((val) => val.toLowerCase() === 'true')
      .default('false'),
    /**
     * The start block number to index from
     */
    START_BLOCK: z
      .string()
      .transform((val) => BigInt(val))
      .optional(),
    /**
     * How many blocks to fetch at a time
     */
    FETCH_BLOCK_SIZE: z
      .string()
      .transform((val) => BigInt(val))
      .default('60'),
    /**
     * How many blocks to wait before taking a snapshot of the Gnosis token balances
     */
    GNOSIS_TOKEN_SNAPSHOT_BLOCK_INTERVAL: z
      .string()
      .transform((val) => BigInt(val))
      .default('15000'),
    /**
     * How many blocks to wait before recording the token price
     */
    TOKEN_PRICE_SNAPSHOT_BLOCK_INTERVAL: z
      .string()
      .transform((val) => BigInt(val))
      .default('720'), // ~1 hour at 5 seconds per block
    ENABLE_INDEXING: z
      .string()
      .transform((val) => val.toLowerCase() === 'true')
      .default('false'),
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

// Validate and parse environment variables
// Replace individual exports with parsed values
export const {
  NODE_ENV,
  IS_DOCKER,
  HTTP_SERVER_PORT,
  HTTP_SERVER_HOST,
  SOCKET_IO_SERVER_PORT,
  MONGODB_URI,
  MONGODB_DEBUG,
  SENTRY_DSN,
  JSON_RPC_PROVIDER_GNOSIS,
  WEBSOCKET_JSON_RPC_PROVIDER_GNOSIS,
  RESUME_INDEXING,
  START_BLOCK,
  FETCH_BLOCK_SIZE,
  GNOSIS_TOKEN_SNAPSHOT_BLOCK_INTERVAL,
  TOKEN_PRICE_SNAPSHOT_BLOCK_INTERVAL,
  ENABLE_INDEXING,
  LOGGER_MONGODB_TRANSPORT_ENABLED,
  LOGGER_MONGODB_TRANSPORT_URI,
  REDIS_URL,
} = envSchema.parse(process.env);
