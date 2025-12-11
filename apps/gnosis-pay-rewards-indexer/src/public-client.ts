import { createPublicClient, http, webSocket } from 'viem';
import {
  ARCHIVE_JSON_RPC_PROVIDER_GNOSIS,
  JSON_RPC_PROVIDER_GNOSIS,
  WEBSOCKET_JSON_RPC_PROVIDER_GNOSIS,
} from './config/env.ts';
import { gnosis } from 'viem/chains';

/**
 * Gnosis chain public client for the running indexer
 */
export const gnosisChainPublicClient = createPublicClient({
  chain: gnosis,
  transport: WEBSOCKET_JSON_RPC_PROVIDER_GNOSIS
    ? webSocket(WEBSOCKET_JSON_RPC_PROVIDER_GNOSIS)
    : http(JSON_RPC_PROVIDER_GNOSIS),
  batch: {
    multicall: true,
  },
});

/**
 * Gnosis chain archive client for fetching historical blocks
 */
export const gnosisChainArchiveClient = createPublicClient({
  chain: gnosis,
  transport: http(ARCHIVE_JSON_RPC_PROVIDER_GNOSIS),
  batch: {
    multicall: true,
  },
});
