import {
  GnosisPayRewardDistributionDocumentFieldsType,
  GnosisPayRewardDistributionModelType,
  toGnosisPayRewardDistributionDocumentId,
  WeekCashbackRewardModelType,
} from '@karpatkey/gnosis-pay-rewards-sdk/mongoose';
import {
  gnosisPayRewardDistributionSafeAddress,
  gnoToken,
  toWeekId,
  WeekIdFormatType,
} from '@karpatkey/gnosis-pay-rewards-sdk';
import { Address, formatUnits, isAddress, isAddressEqual, isHash } from 'viem';
import { getGnosisPayRewardDistributionLogs } from '../gp/getGnosisPayRewardDistributionLogs.js';
import { getBlockByNumber } from './actions.js';
import { GnosisChainPublicClient } from './types.js';
import { FilterQuery } from 'mongoose';

type MongooseModels = {
  gnosisPayRewardDistributionModel: GnosisPayRewardDistributionModelType;
  weekCashbackRewardModel: WeekCashbackRewardModelType;
};

/**
 * Handles the distribution of rewards for a given week.
 * Creates a new reward distribution document and updates the `earnedReward` field of the corresponding week cashback reward document.
 */
export async function processGnosisPayRewardDistributionLog({
  log,
  mongooseModels,
  client,
}: {
  // client: GnosisChainPublicClient;
  log: Awaited<ReturnType<typeof getGnosisPayRewardDistributionLogs>>[number];
  mongooseModels: MongooseModels;
  client: GnosisChainPublicClient;
}) {
  try {
    const { blockNumber, transactionHash } = log;
    const { gnosisPayRewardDistributionModel } = mongooseModels;

    if (!isAddressEqual(log.args.from as Address, gnosisPayRewardDistributionSafeAddress)) {
      throw new Error(`Invalid from address: ${log.args.from}`, {
        cause: 'NOT_FROM_KARPATKEY_REWARD_DISTRIBUTION_SAFE',
      });
    }

    const safeAddress = log.args.to?.toLowerCase() as Address;

    if (!safeAddress || !isAddress(safeAddress)) {
      throw new Error(`Invalid to address: ${safeAddress}`, {
        cause: 'NOT_ADDRESS',
      });
    }

    const block = await getBlockByNumber({
      blockNumber,
      client,
    });

    const documentId = toGnosisPayRewardDistributionDocumentId(transactionHash, safeAddress);
    // Get the last week id
    // Distributions are for the last week happen on the current week, so we roll back one week
    const lastWeekId = toWeekId(block.timestamp, 1);

    // Validate that the log has not already been processed
    const existingLog = await gnosisPayRewardDistributionModel.findById(documentId);
    if (existingLog !== null) {
      throw new Error(`Log already processed: ${documentId}`, {
        cause: 'LOG_ALREADY_PROCESSED',
      });
    }

    const mongooseSession = await mongooseModels.gnosisPayRewardDistributionModel.startSession();
    mongooseSession.startTransaction();

    const distributionDocument =
      await new gnosisPayRewardDistributionModel<GnosisPayRewardDistributionDocumentFieldsType>({
        _id: documentId,
        amount: Number(formatUnits(log.args.value as bigint, gnoToken.decimals)),
        blockNumber: Number(blockNumber),
        transactionHash,
        safe: safeAddress,
        week: lastWeekId,
      });

    await distributionDocument.save({ session: mongooseSession });

    // Update the week cashback reward document
    await mongooseModels.weekCashbackRewardModel.findOneAndUpdate(
      {
        week: lastWeekId,
        safe: safeAddress,
      },
      {
        $set: {
          earnedReward: distributionDocument.amount,
        },
      },
      { session: mongooseSession },
    );

    await mongooseSession.commitTransaction();
    await mongooseSession.endSession();

    const distributionJson = distributionDocument.toJSON();

    return {
      data: distributionJson,
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error as Error,
    };
  }
}

/**
 * Adds the week id to the gnosis pay reward distribution documents that do not have a week id.
 * @param mongooseModel - The mongoose model for the gnosis pay reward distribution.
 * @param client - The client to get the block by number.
 * @param addresses - The addresses to add the week id to.
 */
export async function addWeekIdToGnosisPayRewardDistributionDocuments(
  mongooseModel: GnosisPayRewardDistributionModelType,
  client: GnosisChainPublicClient,
  filters?: {
    transactionHash?: string;
    safeAddresses?: Address[];
  },
): Promise<{
  documentCount: number;
  weekIds: WeekIdFormatType[];
}> {
  const findQuery: FilterQuery<GnosisPayRewardDistributionDocumentFieldsType> = {
    week: null,
  };

  // Validate the addresses array
  if (Array.isArray(filters?.safeAddresses) && filters.safeAddresses.length > 0) {
    if (filters.safeAddresses.some((address) => !isAddress(address))) {
      throw new Error(`Invalid safe addresses: ${filters.safeAddresses.join(', ')}`);
    }
    // Add the addresses to the query
    findQuery.safe = {
      $in: filters.safeAddresses.map((address) => address.toLowerCase()),
    };
  }

  if (filters?.transactionHash) {
    if (!isHash(filters.transactionHash)) {
      throw new Error(`Invalid transaction hash: ${filters.transactionHash}`);
    }

    findQuery.transactionHash = filters.transactionHash.toLowerCase();
  }

  const documents = await mongooseModel.find(findQuery);
  const documentCount = documents.length;
  const weekIdsSet = new Set<WeekIdFormatType>();

  console.log(`Found ${documentCount} documents to update`);

  const mongooseSession = await mongooseModel.startSession();
  mongooseSession.startTransaction();

  for (const document of documents) {
    const block = await getBlockByNumber({
      blockNumber: BigInt(document.blockNumber),
      client,
    });

    const weekId = toWeekId(block.timestamp, 1);

    weekIdsSet.add(weekId);

    await mongooseModel.findByIdAndUpdate(
      document._id,
      {
        week: weekId,
      },
      { session: mongooseSession },
    );
  }

  await mongooseSession.commitTransaction();
  await mongooseSession.endSession();

  return {
    documentCount,
    weekIds: Array.from(weekIdsSet),
  };
}
