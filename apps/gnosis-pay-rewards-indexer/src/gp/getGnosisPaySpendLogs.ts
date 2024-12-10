import { gnosisPaySpendAddress, gnosisPaySpenderModuleAddress } from '@karpatkey/gnosis-pay-rewards-sdk';
import retry from 'async-retry';
import { buildRetryOptions, GnosisPayGetLogsParams } from './commons.js';

export async function getGnosisPaySpendLogs({ client, fromBlock, toBlock, retries, verbose }: GnosisPayGetLogsParams) {
  return retry(
    () =>
      client.getLogs({
        fromBlock,
        toBlock,
        event: gnosisPaySpendEventAbiItem,
        args: {
          receiver: gnosisPaySpendAddress,
        },
        address: gnosisPaySpenderModuleAddress,
        strict: false,
      }),
    buildRetryOptions({ name: 'getGnosisPaySpendLogs', verbose, retries }),
  );
}

export const gnosisPaySpendEventAbiItem = {
  name: 'Spend',
  type: 'event',
  inputs: [
    { indexed: false, internalType: 'address', name: 'asset', type: 'address' },
    { indexed: false, internalType: 'address', name: 'account', type: 'address' },
    { indexed: false, internalType: 'address', name: 'receiver', type: 'address' },
    { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
  ],
} as const;
