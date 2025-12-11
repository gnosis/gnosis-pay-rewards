import {
  createSafeWeekRewardsSnapshotDocument,
  RewardTransactionModelType,
  SafeWeekRewardsSnapshotModelType,
} from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import {
  gCrcToken,
  GnoisPayTokenType,
  gnoToken,
  moneriumEureToken,
  moneriumGbpToken,
  payoutSafes,
  RewardTransactionFieldsType,
  toWeekId,
  WeekIdFormatType,
} from '@kpk/gnosis-pay-rewards-sdk';
import { CachedTokenPriceProvider } from '../lib/cached-token-price-provider.ts';
import type { FilterQuery } from 'mongoose';
import { Address, formatUnits, isAddress, isAddressEqual, isHash } from 'viem';
import { retry } from '../lib/retry.ts';
import type { TokenTransferLogType } from '../gp/getTokenTransferLogs.ts';
import { GnosisChainPublicClient } from './types.ts';
import type { BlockInfoProvider } from '../lib/block-info-provider.ts';
import type { RedisCache } from '../lib/redis-cache.ts';

type MongooseModels = {
  rewardTransactionModel: RewardTransactionModelType;
  safeWeekRewardsSnapshotModel: SafeWeekRewardsSnapshotModelType;
};

type ProcessRewardTransactionLogParams = {
  log: TokenTransferLogType;
  mongooseModels: MongooseModels;
  client: GnosisChainPublicClient;
  blockInfoProvider: BlockInfoProvider;
  redisCache: RedisCache;
};

/**
 * Calculates the USD, EUR, and GBP values of a token amount at a specific block number.
 * @param priceProvider - The cached token price provider instance
 * @param token - The token with oracle address and decimals
 * @param tokenAmount - The raw token amount (in smallest unit, e.g. wei)
 * @param blockNumber - The block number to get the price at
 * @returns The USD, EUR, and GBP values of the token amount
 * @throws Error if token price cannot be fetched
 */
async function calculateTokenValues(
  priceProvider: CachedTokenPriceProvider,
  token: GnoisPayTokenType,
  tokenAmount: bigint,
  blockNumber: bigint,
): Promise<{
  valueUSD: number;
  valueEUR: number;
  valueGBP: number;
}> {
  const amount = Number(formatUnits(tokenAmount, token.decimals));

  // Calculate USD value
  const valueUSD = await priceProvider.value({
    tokenA: token,
    amount,
    blockNumber,
  });

  // Get EUR/USD and GBP/USD exchange rates
  const [eurUsdPrice, gbpUsdPrice] = await Promise.all([
    priceProvider.price({ tokenA: moneriumEureToken, blockNumber }),
    priceProvider.price({ tokenA: moneriumGbpToken, blockNumber }),
  ]);

  // Convert USD value to EUR and GBP
  const valueEUR = valueUSD / eurUsdPrice;
  const valueGBP = valueUSD / gbpUsdPrice;

  return {
    valueUSD,
    valueEUR,
    valueGBP,
  };
}

/**
 * Checks if an error is a MongoDB write conflict error
 */
function isWriteConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const errorMessage = error.message.toLowerCase();
  return (
    errorMessage.includes('write conflict') ||
    errorMessage.includes('transienttransactionerror') ||
    errorMessage.includes('writetransactionconflict')
  );
}

/**
 * Handles the distribution of rewards for a given week.
 * Creates a new reward distribution document and updates the `earnedRewards` array of the corresponding week cashback reward document.
 */
export async function processRewardTransactionLog(
  params: ProcessRewardTransactionLogParams,
) {
  const { log, mongooseModels, client, blockInfoProvider, redisCache } = params;
  try {
    const { blockNumber, transactionHash } = log;
    const { rewardTransactionModel } = mongooseModels;
    const fromAddress = log.args.from?.toLowerCase() as Address;
    const tokenAddress = log.address.toLowerCase() as Address;

    if (
      !isAddressEqual(
        fromAddress,
        payoutSafes.gnosisPay,
      ) &&
      !isAddressEqual(
        fromAddress,
        payoutSafes.metri,
      )
    ) {
      throw new Error(`Invalid from address: ${fromAddress}`, {
        cause: 'NOT_FROM_PAYOUT_SAFE',
      });
    }

    const safeAddress = log.args.to?.toLowerCase() as Address;

    if (!safeAddress || !isAddress(safeAddress)) {
      throw new Error(`Invalid to address: ${safeAddress}`, {
        cause: 'NOT_ADDRESS',
      });
    }

    const block = await blockInfoProvider.getBlockInfo(Number(blockNumber));

    const documentId = rewardTransactionModel.createDocumentId(
      transactionHash,
      safeAddress,
      log.logIndex,
    );
    // Get the last week id
    // Distributions are for the last week happen on the current week, so we roll back one week
    const lastWeekId = toWeekId(block.timestamp, 1);

    // Validate that the log has not already been processed
    const existingLog = await rewardTransactionModel.findById(documentId);
    if (existingLog !== null) {
      throw new Error(`Log already processed: ${documentId}`, {
        cause: 'LOG_ALREADY_PROCESSED',
      });
    }

    // Determine which token is being transferred based on the log address
    // gCrcToken comes from payoutSafes.metri, gnoToken comes from payoutSafes.gnosisPay
    const rewardToken = isAddressEqual(tokenAddress, gCrcToken.address) ? gCrcToken : gnoToken;

    // Create cached token price provider instance
    const priceProvider = new CachedTokenPriceProvider(client, redisCache);

    // Calculate USD, EUR, and GBP values of the reward
    const { valueUSD, valueEUR, valueGBP } = await calculateTokenValues(
      priceProvider,
      rewardToken,
      log.args.value as bigint,
      BigInt(blockNumber),
    );

    const amount = Number(
      formatUnits(log.args.value as bigint, rewardToken.decimals),
    );

    const executeTransaction = async () => {
      const mongooseSession = await mongooseModels.rewardTransactionModel
        .startSession();
      mongooseSession.startTransaction();

      try {
        const distributionDocument = new rewardTransactionModel<
          RewardTransactionFieldsType
        >({
          _id: documentId as `${`0x${string}`}/${Address}/${number}`,
          amount,
          block: Number(blockNumber),
          transactionHash,
          from: fromAddress,
          recipient: safeAddress,
          token: tokenAddress,
          week: lastWeekId,
          valueUSD,
          valueEUR,
          valueGBP,
        });

        await distributionDocument.save({ session: mongooseSession });

        // Get or create the week cashback reward document and add earned reward reference
        const weekRewardSnapshotDocument = await createSafeWeekRewardsSnapshotDocument(
          mongooseModels.safeWeekRewardsSnapshotModel,
          {
            week: lastWeekId,
            address: safeAddress,
          },
          mongooseSession,
        );

        // Add reward transaction reference using the method
        await weekRewardSnapshotDocument.addEarnedReward(documentId, {
          save: true,
          session: mongooseSession,
        });

        await mongooseSession.commitTransaction();
        await mongooseSession.endSession();

        return distributionDocument.toJSON();
      } catch (error) {
        // Abort transaction and end session on error
        await mongooseSession.abortTransaction();
        await mongooseSession.endSession();
        throw error;
      }
    };

    let distributionJson;
    try {
      distributionJson = await executeTransaction();
    } catch (error) {
      // Only retry on write conflict errors
      if (isWriteConflictError(error)) {
        distributionJson = await retry(
          executeTransaction,
          {
            retries: 5,
            minTimeout: 50, // Start with 50ms
            maxTimeout: 1000, // Max 1 second between retries
            factor: 2, // Exponential backoff
            randomize: true, // Add jitter to reduce concurrent retries
          },
        );
      } else {
        // For non-write-conflict errors, throw immediately
        throw error;
      }
    }

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
export async function addWeekIdToRewardTransactionDocuments(
  mongooseModel: RewardTransactionModelType,
  blockInfoProvider: BlockInfoProvider,
  filters?: {
    transactionHash?: string;
    safeAddresses?: Address[];
  },
): Promise<{
  documentCount: number;
  weekIds: WeekIdFormatType[];
}> {
  const findQuery: FilterQuery<RewardTransactionFieldsType> = {
    week: null,
  };

  // Validate the addresses array
  if (
    Array.isArray(filters?.safeAddresses) && filters.safeAddresses.length > 0
  ) {
    if (filters.safeAddresses.some((address) => !isAddress(address))) {
      throw new Error(
        `Invalid safe addresses: ${filters.safeAddresses.join(', ')}`,
      );
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

  const mongooseSession = await mongooseModel.startSession();
  mongooseSession.startTransaction();

  for (const document of documents) {
    const blockNumber = BigInt(document.block);
    const block = await blockInfoProvider.getBlockInfo(Number(blockNumber));

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
