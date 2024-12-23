import { toWeekId } from '@karpatkey/gnosis-pay-rewards-sdk';
import {
  WeekCashbackRewardModelType,
  GnosisTokenBalanceSnapshotModelType,
  GnosisPaySafeAddressModelType,
  WeekMetricsSnapshotModelType,
} from '@karpatkey/gnosis-pay-rewards-sdk/mongoose';
import retry from 'async-retry';
import { Block, isAddressEqual } from 'viem';
import { Logger } from 'winston';

import { GnosisChainPublicClient } from './process/types.js';
import { takeGnosisTokenBalanceSnapshot } from './process/processGnosisTokenTransferLog.js';
import { buildRetryOptions } from './gp/commons.js';
import { GNOSIS_TOKEN_SNAPSHOT_BLOCK_INTERVAL } from './config/env.js';

type HandleBlockParamsType = {
  block: Block;
  client: GnosisChainPublicClient;
  logger: Logger;

  mongooseModels: {
    weekMetricsSnapshotModel: WeekMetricsSnapshotModelType;
    gnosisPaySafeAddressModel: GnosisPaySafeAddressModelType;
    gnosisTokenBalanceSnapshotModel: GnosisTokenBalanceSnapshotModelType;
    weekCashbackRewardModel: WeekCashbackRewardModelType;
  };
};

/**
 * Handle a week gnosis token balance snapshots
 * @param params - The parameters for handling the week
 */
async function handleBlockGnosisTokenBalanceSnapshots({
  block,
  client,
  logger,
  mongooseModels,
}: HandleBlockParamsType) {
  const childLogger = logger.child({
    function: 'handleBlockGnosisTokenBalanceSnapshots',
  });

  // Check this every 100 blocks
  if (!block.number) {
    childLogger.info(`block number is not defined, skipping`);
    return;
  }

  // Take a snapshot every 15000 blocks
  if (block.number % GNOSIS_TOKEN_SNAPSHOT_BLOCK_INTERVAL !== 0n) {
    return;
  }

  // transform the timestamp to a week number
  const weekId = toWeekId(block.timestamp);
  // All safe addresses array
  const gnosisPaySafeAddreses = await mongooseModels.gnosisPaySafeAddressModel
    .find({})
    .select({
      address: 1,
    })
    .lean()
    .then((documents) => documents.map(({ address }) => address));

  // Get all GNO snapshots for the week
  const gnosisTokenBalanceSnapshots = await mongooseModels.gnosisTokenBalanceSnapshotModel
    .find({
      weekId,
    })
    .lean();

  childLogger.info(`found ${gnosisPaySafeAddreses.length} safe addresses`);
  childLogger.info(`found ${gnosisTokenBalanceSnapshots.length} gnosis token balance snapshots for week ${weekId}`, {
    weekId,
  });

  for (const safeAddress of gnosisPaySafeAddreses) {
    const doesHaveGnosisTokenBalanceSnapshot = gnosisTokenBalanceSnapshots.some((snapshot) =>
      isAddressEqual(snapshot.safe, safeAddress)
    );

    if (!doesHaveGnosisTokenBalanceSnapshot) {
      childLogger.info(`taking gnosis token balance snapshot for safe address ${safeAddress} for week ${weekId}`);

      await takeGnosisTokenBalanceSnapshot({
        ...mongooseModels,
        blockNumber: block.number as bigint,
        client,
        safeAddress,
      });
    }
  }
}

/**
 * Handle a block
 * @param params - The parameters for handling the block
 */
export async function handleBlock({ block, client, logger, mongooseModels }: HandleBlockParamsType) {
  try {
    await retry(
      () => handleBlockGnosisTokenBalanceSnapshots({ block, client, logger, mongooseModels }),
      buildRetryOptions({
        name: 'handleBlockGnosisTokenBalanceSnapshots',
        logger,
      })
    );
    logger.info(`handled block ${block.number}`);
  } catch (error) {
    logger.error(`error handling block ${block.number}: ${error}`);
  }
}
