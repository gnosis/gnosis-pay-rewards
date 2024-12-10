import { gnoToken, gnosisPayRewardDistributionSafeAddress } from '@karpatkey/gnosis-pay-rewards-sdk';
import { erc20Abi } from 'viem';
import retry from 'async-retry';
import { buildRetryOptions, GnosisPayGetLogsParams } from './commons.js';

export async function getGnosisPayRewardDistributionLogs({
  client,
  fromBlock,
  toBlock,
  retries,
  verbose,
}: GnosisPayGetLogsParams) {
  return retry(
    () =>
      client.getLogs({
        address: gnoToken.address,
        args: {
          from: gnosisPayRewardDistributionSafeAddress,
        },
        event: erc20Abi[1],
        fromBlock,
        toBlock,
        strict: false,
      }),
    buildRetryOptions({ name: 'getGnosisPayRewardDistributionLogs', verbose, retries }),
  );
}
