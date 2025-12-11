import { CreateModelsReturnType } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import { tokenBalanceSnapshotTokens, WeekIdFormatType } from '@kpk/gnosis-pay-rewards-sdk';
import 'mongoose-paginate-v2';
import { Logger } from 'winston';

import { takeTokenBalanceSnapshot } from '../process/token-transfer.ts';
import { GnosisChainPublicClient } from '../process/types.ts';
import type { BlockInfoProvider } from '../lib/block-info-provider.ts';

type AddMissingWeeksGnosisTokenBalanceSnapshotParams = {
  safeAddress: `0x${string}`;
  mongooseModels: CreateModelsReturnType;
  client: GnosisChainPublicClient;
  logger: Logger;
  blockInfoProvider: BlockInfoProvider;
};

export async function addMissingWeeksGnosisTokenBalanceSnapshot({
  mongooseModels,
  safeAddress,
  logger,
  client,
  blockInfoProvider,
}: AddMissingWeeksGnosisTokenBalanceSnapshotParams) {
  safeAddress = safeAddress.toLowerCase() as `0x${string}`;

  const { tokenBalanceSnapshotModel } = mongooseModels;

  // Get all weeks ids
  const allWeeksIds = (await tokenBalanceSnapshotModel.distinct('week')) as WeekIdFormatType[];

  // Get all weeks ids with snapshots for the safe
  const allSafeWeeksIdsWithSnapshots = (await tokenBalanceSnapshotModel.distinct('week', {
    safe: safeAddress,
  })) as WeekIdFormatType[];

  // Get missing weeks ids
  const missingWeeksIds = allWeeksIds.filter((weekId) => !allSafeWeeksIdsWithSnapshots.includes(weekId));

  for (const missingWeekId of missingWeeksIds) {
    // Find a reference to the block number among the other snapshots of the same week
    const otherSnapshotReference = await tokenBalanceSnapshotModel
      .findOne({ week: missingWeekId }, { block: 1 })
      .sort({ block: -1 })
      .limit(1)
      .lean();

    if (!otherSnapshotReference) {
      logger.error(`no block number found for week ${missingWeekId}`);
      continue;
    }

    // Take snapshots for all tokens
    await Promise.all(
      tokenBalanceSnapshotTokens.map((token) =>
        takeTokenBalanceSnapshot(
          {
            client,
            tokenBalanceSnapshotModel: mongooseModels.tokenBalanceSnapshotModel,
            safeWeekRewardsSnapshotModel: mongooseModels.safeWeekRewardsSnapshotModel,
            safeModel: mongooseModels.gnosisPaySafeModel,
            blockInfoProvider,
          },
          {
            address: safeAddress,
            token,
            blockNumber: BigInt(otherSnapshotReference.block),
          },
        ).catch((error) => {
          logger.error(
            `Failed to take token snapshot for ${safeAddress} token ${token.symbol}:`,
            error,
          );
        })
      ),
    );
  }
}
