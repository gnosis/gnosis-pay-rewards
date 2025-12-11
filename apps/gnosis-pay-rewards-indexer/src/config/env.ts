import { load } from '@std/dotenv';
import { envZodSchema } from './env-zod.ts';
import z from 'zod';

function toAbsoluteEnvPath(envPath: string) {
  const currentFileUrl = new URL(import.meta.url);
  const projectRoot = new URL('../../', currentFileUrl);
  const projectRootPath = projectRoot.pathname;
  return `${projectRootPath}${envPath}`;
}

async function validateEnv() {
  try {
    // Load environment variables from the appropriate file
    const envPath = Deno.env.get('NODE_ENV') === 'production'
      ? toAbsoluteEnvPath('.env.production')
      : toAbsoluteEnvPath('.env.development');

    const envVars = await load({ envPath });

    // Merge with Deno.env (which may contain variables from --env-file)
    // Deno.env takes precedence over file values
    const mergedEnvVars = {
      ...envVars,
      ...Deno.env.toObject(),
    };

    // Validate and transform environment variables
    const validatedEnv = envZodSchema.parse(mergedEnvVars);

    return validatedEnv;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.filter((err) => err.message === 'Required').map((err) => err.path.join('.'));

      const invalidVars = error.errors
        .filter((err) => err.message !== 'Required')
        .map((err) => `${err.path.join('.')}: ${err.message}`);

      console.error('❌ Invalid environment variables:');

      if (missingVars.length > 0) {
        console.error('Missing required variables:');
        missingVars.forEach((variable) => console.error(`  - ${variable}`));
      }

      if (invalidVars.length > 0) {
        console.error('Invalid variables:');
        invalidVars.forEach((message) => console.error(`  - ${message}`));
      }

      Deno.exit(1);
    }

    throw error;
  }
}

// Validate and export environment variables
const validatedEnv = await validateEnv();

// Validate and parse environment variables
// Replace individual exports with parsed values
export const {
  NODE_ENV,
  IS_DOCKER,
  HTTP_SERVER_PORT,
  HTTP_SERVER_HOSTNAME,
  MONGODB_URI,
  MONGODB_DEBUG,
  SENTRY_DSN,
  JSON_RPC_PROVIDER_GNOSIS,
  WEBSOCKET_JSON_RPC_PROVIDER_GNOSIS,
  ARCHIVE_JSON_RPC_PROVIDER_GNOSIS,
  RESUME_INDEXING,
  FETCH_BLOCK_SIZE,
  GNOSIS_TOKEN_SNAPSHOT_BLOCK_INTERVAL,
  TOKEN_PRICE_SNAPSHOT_BLOCK_INTERVAL,
  ENABLE_INDEXING,
  LOGGER_MONGODB_TRANSPORT_ENABLED,
  LOGGER_MONGODB_TRANSPORT_URI,
  LOGGER_FILE_TRANSPORT_ENABLED,
  LOGGER_FILE_TRANSPORT_DIR,
  LOGGER_FILE_TRANSPORT_FILENAME,
  LOGGER_FILE_TRANSPORT_MAX_SIZE,
  LOGGER_FILE_TRANSPORT_MAX_FILES,
  REDIS_URL,
  THE_GRAPH_API_KEY,
  INDEXER_ENABLE_CONSOLE_LOGGER,
} = validatedEnv;
