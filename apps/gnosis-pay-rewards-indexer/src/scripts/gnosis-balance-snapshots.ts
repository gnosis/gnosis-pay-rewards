import {
  GnosisTokenBalanceSnapshotModelType,
  WeekCashbackRewardModelType,
  GnosisPaySafeAddressModelType,
} from '@karpatkey/gnosis-pay-rewards-sdk/mongoose';
import { WeekIdFormatType } from '@karpatkey/gnosis-pay-rewards-sdk';
import 'mongoose-paginate-v2';
import { Logger } from 'winston';

import { takeGnosisTokenBalanceSnapshot } from '../process/processGnosisTokenTransferLog.js';
import { GnosisChainPublicClient } from '../process/types.js';

type AddMissingWeeksGnosisTokenBalanceSnapshotParams = {
  safeAddress: `0x${string}`;
  mongooseModels: {
    gnosisPaySafeAddressModel: GnosisPaySafeAddressModelType;
    gnosisTokenBalanceSnapshotModel: GnosisTokenBalanceSnapshotModelType;
    weekCashbackRewardModel: WeekCashbackRewardModelType;
  };
  client: GnosisChainPublicClient;
  logger: Logger;
};

export async function addMissingWeeksGnosisTokenBalanceSnapshot({
  mongooseModels,
  safeAddress,
  logger,
  client,
}: AddMissingWeeksGnosisTokenBalanceSnapshotParams) {
  safeAddress = safeAddress.toLowerCase() as `0x${string}`;

  const { gnosisTokenBalanceSnapshotModel } = mongooseModels;

  // Get all weeks ids
  const allWeeksIds = (await gnosisTokenBalanceSnapshotModel.distinct('weekId')) as WeekIdFormatType[];

  // Get all weeks ids with snapshots for the safe
  const allSafeWeeksIdsWithSnapshots = (await gnosisTokenBalanceSnapshotModel.distinct('weekId', {
    safe: safeAddress,
  })) as WeekIdFormatType[];

  // Get missing weeks ids
  const missingWeeksIds = allWeeksIds.filter((weekId) => !allSafeWeeksIdsWithSnapshots.includes(weekId));

  for (const missingWeekId of missingWeeksIds) {
    // Find a reference to the block number among the other snapshots of the same week
    const otherSnapshotReference = await gnosisTokenBalanceSnapshotModel
      .findOne({ weekId: missingWeekId }, { blockNumber: 1 })
      .sort({ number: -1 })
      .limit(1)
      .lean();

    if (!otherSnapshotReference) {
      logger.error(`no block number found for week ${missingWeekId}`);
      continue;
    }

    await takeGnosisTokenBalanceSnapshot({
      ...mongooseModels,
      blockNumber: BigInt(otherSnapshotReference.blockNumber),
      safeAddress,
      client,
    });
  }
}
