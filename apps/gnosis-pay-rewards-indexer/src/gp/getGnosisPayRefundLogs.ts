import {
  gnosisPaySpendAddress,
  moneriumEureToken,
  moneriumGbpToken,
  usdcBridgeToken,
  circleUsdcToken,
} from '@karpatkey/gnosis-pay-rewards-sdk';
import retry from 'async-retry';
import { buildRetryOptions, erc20TransferEventAbiItem, GnosisPayGetLogsParams } from './commons.js';

export async function getGnosisPayRefundLogs({ client, fromBlock, toBlock, retries, verbose }: GnosisPayGetLogsParams) {
  return retry(
    () =>
      client.getLogs({
        fromBlock,
        toBlock,
        event: erc20TransferEventAbiItem,
        args: {
          from: gnosisPaySpendAddress,
        },
        address: [moneriumEureToken, moneriumGbpToken, usdcBridgeToken, circleUsdcToken].map((token) => token.address),
        strict: false,
      }),
    buildRetryOptions({ name: 'getGnosisPayRefundLogs', verbose, retries }),
  );
}
