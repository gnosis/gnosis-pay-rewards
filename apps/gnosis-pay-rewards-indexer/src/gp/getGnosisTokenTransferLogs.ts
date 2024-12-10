import { gnoToken } from '@karpatkey/gnosis-pay-rewards-sdk';
import retry from 'async-retry';
import { buildRetryOptions, erc20TransferEventAbiItem, GnosisPayGetLogsParams } from './commons.js';

export async function getGnosisTokenTransferLogs({
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
        address: gnoToken.address,
        event: erc20TransferEventAbiItem,
        strict: false,
      }),
    buildRetryOptions({ name: 'getGnosisTokenTransferLogs', verbose, retries }),
  );
}
