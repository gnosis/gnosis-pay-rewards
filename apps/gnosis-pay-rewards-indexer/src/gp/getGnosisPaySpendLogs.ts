import { gnosisPaySpendAddress, gnosisPaySpenderModuleAddress } from '@kpk/gnosis-pay-rewards-sdk';
import { retry } from '../lib/retry.ts';
import { buildRetryOptions, GnosisPayGetLogsParams } from './commons.ts';

export function getGnosisPaySpendLogs(
  { client, fromBlock, toBlock, retries, verbose }: GnosisPayGetLogsParams,
) {
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

export type GnosisPaySpendLogType = Awaited<
  ReturnType<typeof getGnosisPaySpendLogs>
>[number];

export const gnosisPaySpendEventAbiItem = {
  name: 'Spend',
  type: 'event',
  inputs: [
    { indexed: false, internalType: 'address', name: 'asset', type: 'address' },
    {
      indexed: false,
      internalType: 'address',
      name: 'account',
      type: 'address',
    },
    {
      indexed: false,
      internalType: 'address',
      name: 'receiver',
      type: 'address',
    },
    {
      indexed: false,
      internalType: 'uint256',
      name: 'amount',
      type: 'uint256',
    },
  ],
} as const;
