/**
 * Application environment: development, staging, production. Defaults to development.
 */
export const APP_ENV = process.env.MODE || 'development';

// Validate env variables
if (!['development', 'staging', 'production'].includes(APP_ENV)) {
  throw new Error(`Invalid APP_ENV: ${APP_ENV}`);
}

/**
 * Alchemy API key.
 */
export const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_KEY;

/**
 * WalletConnect project ID.
 */
export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID as string;
export const NEXT_PUBLIC_INDEXER_SOCKET_API_URL = process.env.NEXT_PUBLIC_INDEXER_SOCKET_API_URL as string;
export const NEXT_PUBLIC_INDEXER_HTTP_API_URL = process.env.NEXT_PUBLIC_INDEXER_HTTP_API_URL as string;
