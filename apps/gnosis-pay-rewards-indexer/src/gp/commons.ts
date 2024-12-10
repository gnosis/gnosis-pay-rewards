import { PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';

/**
 * Common params for all GnosisPay getLogs functions
 */
export type GnosisPayGetLogsParams = {
  client: PublicClient<Transport, typeof gnosis>;
  fromBlock: bigint;
  toBlock: bigint;
  retries?: number;
  verbose?: boolean;
};

/**
 * Number of default retries for getLogs
 */
export const defaultRetries = 30;

/**
 * Builds a retry handler for getLogs
 * @param name - The name of the function
 * @param verbose - Whether to log the error
 * @returns The retry handler
 */
export function buildRetryOptions({
  retries = defaultRetries,
  name,
  verbose = false,
}: {
  retries?: number;
  name: string;
  verbose?: boolean;
}) {
  const onRetry = (error: Error, attempt: number) => {
    if (verbose) {
      console.log(`${name}: failed on attempt ${attempt}`, error);
    }
  };

  return { retries, onRetry };
}

export const erc20TransferEventAbiItem = {
  name: 'Transfer',
  type: 'event',
  inputs: [
    { indexed: true, internalType: 'address', name: 'from', type: 'address' },
    { indexed: true, internalType: 'address', name: 'to', type: 'address' },
    { indexed: true, internalType: 'uint256', name: 'value', type: 'uint256' },
  ],
} as const;

export const gnosisPaySafeAvatarFunctionAbiItem = {
  inputs: [],
  name: 'avatar',
  outputs: [{ internalType: 'address', name: '', type: 'address' }],
  stateMutability: 'view',
  type: 'function',
} as const;

export const erc721TransferEventAbiItem = {
  type: 'event',
  name: 'Transfer',
  inputs: [
    { indexed: true, name: 'from', type: 'address' },
    { indexed: true, name: 'to', type: 'address' },
    { indexed: true, name: 'tokenId', type: 'uint256' },
  ],
} as const;
