import {
  circleUsdcToken,
  gnosisPaySpendAddress,
  moneriumEureToken,
  moneriumGbpToken,
  usdcBridgeToken,
} from '@kpk/gnosis-pay-rewards-sdk';
import { retry } from '../lib/retry.ts';
import { buildRetryOptions, erc20TransferEventAbiItem, GnosisPayGetLogsParams } from './commons.ts';

export function getGnosisPayRefundLogs(
  { client, fromBlock, toBlock, retries, verbose }: GnosisPayGetLogsParams,
) {
  return retry(
    () =>
      client.getLogs({
        fromBlock,
        toBlock,
        event: erc20TransferEventAbiItem,
        args: {
          from: gnosisPaySpendAddress,
        },
        address: [
          moneriumEureToken,
          moneriumGbpToken,
          usdcBridgeToken,
          circleUsdcToken,
        ].map((token) => token.address),
        strict: false,
      }),
    buildRetryOptions({ name: 'getGnosisPayRefundLogs', verbose, retries }),
  );
}

export type GnosisPayRefundLogType = Awaited<
  ReturnType<typeof getGnosisPayRefundLogs>
>[number];
