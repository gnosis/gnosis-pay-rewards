import { gnoToken } from '@kpk/gnosis-pay-rewards-sdk';
import { retry } from '../lib/retry.ts';
import { buildRetryOptions, erc20TransferEventAbiItem, GnosisPayGetLogsParams } from './commons.ts';
import { Address } from 'viem';

type GetTokenTransferLogsParams = GnosisPayGetLogsParams & {
  from?: Address | Address[] | null | undefined;
  to?: Address | Address[] | null | undefined;
  address?: Address | undefined;
};

export function getTokenTransferLogs({
  client,
  fromBlock,
  toBlock,
  retries,
  verbose,
  from,
  to,
  address,
}: GetTokenTransferLogsParams) {
  // Default to gnoToken.address if no address is provided
  const tokenAddress = address ?? gnoToken.address;

  return retry(
    () =>
      client.getLogs({
        fromBlock,
        toBlock,
        address: tokenAddress,
        event: erc20TransferEventAbiItem,
        strict: false,
        args: {
          from,
          to,
        },
      }),
    buildRetryOptions({ name: 'getTokenTransferLogs', verbose, retries }),
  );
}

export type TokenTransferLogType = Awaited<ReturnType<typeof getTokenTransferLogs>>[number];
