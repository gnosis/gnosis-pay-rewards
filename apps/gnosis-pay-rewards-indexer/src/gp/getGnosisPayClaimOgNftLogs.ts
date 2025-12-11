import { gnosisPayOgNftAddress, gnosisPayOgNftV2Address } from '@kpk/gnosis-pay-rewards-sdk';
import { zeroAddress } from 'viem';
import { retry } from '../lib/retry.ts';
import { buildRetryOptions, erc721TransferEventAbiItem, GnosisPayGetLogsParams } from './commons.ts';

export function getGnosisPayClaimOgNftLogs({
  client,
  fromBlock,
  toBlock,
  retries,
  verbose,
}: GnosisPayGetLogsParams) {
  return retry(
    () =>
      client.getLogs({
        fromBlock,
        toBlock,
        event: erc721TransferEventAbiItem,
        args: {
          from: zeroAddress,
        },
        address: [gnosisPayOgNftAddress, gnosisPayOgNftV2Address],
        strict: false,
      }),
    buildRetryOptions({ name: 'getGnosisPayClaimOgNftLogs', verbose, retries }),
  );
}

export type GnosisPayClaimOgNftLogType = Awaited<
  ReturnType<typeof getGnosisPayClaimOgNftLogs>
>[number];
