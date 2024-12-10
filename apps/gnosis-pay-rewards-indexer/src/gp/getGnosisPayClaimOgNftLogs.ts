import { gnosisPayOgNftAddress } from '@karpatkey/gnosis-pay-rewards-sdk';
import { zeroAddress } from 'viem';
import retry from 'async-retry';
import { buildRetryOptions, erc721TransferEventAbiItem, GnosisPayGetLogsParams } from './commons.js';

export async function getGnosisPayClaimOgNftLogs({
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
        address: gnosisPayOgNftAddress,
        strict: false,
      }),
    buildRetryOptions({ name: 'getGnosisPayClaimOgNftLogs', verbose, retries }),
  );
}
