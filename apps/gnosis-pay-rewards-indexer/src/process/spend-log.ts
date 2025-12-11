import {
  calculateNetVolumeUSD,
  circleUsdcToken,
  ConditionalReturnType,
  getGnosisPayTokenByAddress,
  getOraclePriceAtBlockNumber,
  type GnoisPayTokenType,
  GnosisPayTransactionFieldsType,
  GnosisPayTransactionType,
  gnoToken,
  toWeekId,
  usdcBridgeToken,
} from '@kpk/gnosis-pay-rewards-sdk';
import {
  createGnosisPaySafeDocument,
  CreateModelsReturnType,
  createSafeWeekRewardsSnapshotDocument,
  createWeekMetricsSnapshotDocument,
} from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import { Address, formatUnits, isAddress, isAddressEqual } from 'viem';
import { retry } from '../lib/retry.ts';
import { getGnosisPaySpendLogs } from '../gp/getGnosisPaySpendLogs.ts';
import { getGnosisPaySafeAddressFromModule } from '../gp/getGnosisPaySafeAddressFromModule.ts';
import { getGnosisPayRefundLogs } from '../gp/getGnosisPayRefundLogs.ts';
import { hasGnosisPayOgNft, hasGnosisPayOgNftV2 } from '../gp/hasGnosisPayOgNft.ts';
import { getGnosisPaySafeOwners as getGnosisPaySafeOwnersCore } from '../gp/getGnosisPaySafeOwners.ts';
import { dayjsUtc as dayjs } from '../lib/dayjs-utc.ts';
import { GnosisChainPublicClient, ProcessLogFnDataType, ProcessLogFunctionParams } from './types.ts';
import { LogAlreadyProcessedError } from './errors.ts';
import type { BlockInfoProvider } from '../lib/block-info-provider.ts';
import { linkMetriSafesToGnosisPaySafe } from './token-transfer.ts';
import type { RedisCache } from '../lib/redis-cache.ts';

async function processTransactionLogCommon({
  client,
  blockNumber,
  transactionHash,
  getSafeAddress,
  tokenAddress,
  amountRaw,
  transactionType,
  mongooseModels,
  blockInfoProvider,
  redisCache,
}: {
  client: GnosisChainPublicClient;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  getSafeAddress: () => Promise<Address>;
  tokenAddress: Address;
  amountRaw: bigint;
  transactionType: GnosisPayTransactionType;
  mongooseModels: CreateModelsReturnType;
  blockInfoProvider: BlockInfoProvider;
  redisCache: RedisCache;
}): Promise<ProcessLogFnDataType> {
  const block = await blockInfoProvider.getBlockInfo(Number(blockNumber));
  const safeAddress = await getSafeAddress();
  const token = validateToken(tokenAddress);

  const safeOwners = await getGnosisPaySafeOwners({
    safeAddress,
    client,
    blockNumber,
  });

  const safeHasOgNft = [
    await hasGnosisPayOgNft(client, safeOwners),
    await hasGnosisPayOgNftV2(client, [safeAddress]),
  ].some((has) => has.some((addr) => addr === true));

  const safeTokenUsdPrice = await getTokenUsdPrice({
    blockNumber,
    client,
    token: token.address,
  });

  const week = toWeekId(block.timestamp);
  const amount = Number(formatUnits(amountRaw, token.decimals));
  const valueUSD = safeTokenUsdPrice * amount;

  const savedData = await saveToDatabase(
    mongooseModels,
    {
      _id: transactionHash,
      amount,
      amountRaw: amountRaw.toString(),
      token: token.address,
      valueUSD,
      block: Number(blockNumber),
      safe: safeAddress,
      type: transactionType,
      transactionHash,
      week,
    },
    {
      safeAddress,
      isOG: safeHasOgNft,
      owners: safeOwners,
    },
  );

  // Link Metri Safes to Gnosis Pay Safe in the background (non-blocking)
  // This resolves metri safes when a gnosis pay spends money
  if (transactionType === GnosisPayTransactionType.Spend) {
    // Fire and forget - run in background without blocking
    linkMetriSafesToGnosisPaySafe(
      {
        client,
        gnosisPaySafeModel: mongooseModels.gnosisPaySafeModel,
        metriSafeModel: mongooseModels.metriSafeModel,
        redisCache,
      },
      safeAddress,
      safeOwners,
    )
      .then(async (metriSafeOwners) => {
        // Create week rewards snapshots for metri safes
        if (metriSafeOwners.length > 0) {
          await Promise.all(
            metriSafeOwners.map(async (metriSafeAddress) => {
              try {
                await createSafeWeekRewardsSnapshotDocument(
                  mongooseModels.safeWeekRewardsSnapshotModel,
                  {
                    week,
                    address: metriSafeAddress,
                  },
                );
              } catch (error) {
                console.error(
                  `Error creating week rewards snapshot for Metri Safe ${metriSafeAddress}:`,
                  error,
                );
              }
            }),
          );
        }
      })
      .catch((error) => {
        // Log error but don't throw - this is background processing
        console.error(
          `Error linking Metri Safes to Gnosis Pay Safe ${safeAddress}:`,
          error,
        );
      });
  }

  return savedData;
}

export async function processSpendLog(
  params:
    & ProcessLogFunctionParams<
      Awaited<ReturnType<typeof getGnosisPaySpendLogs>>[number]
    >
    & { redisCache?: RedisCache },
): Promise<
  | ConditionalReturnType<true, ProcessLogFnDataType, Error>
  | ConditionalReturnType<false, ProcessLogFnDataType, Error>
> {
  const { client, log, mongooseModels, blockInfoProvider, redisCache } = params;
  try {
    await validateLogIsNotAlreadyProcessed(
      mongooseModels.gnosisPayTransactionModel,
      log.transactionHash,
    );

    const { blockNumber, transactionHash } = log;
    const spendAmountRaw = log.args.amount as bigint;
    const rolesModuleAddress = log.args.account?.toLowerCase() as Address;

    if (log.args.account === undefined) {
      throw new Error('Roles module address is undefined');
    }

    if (!isAddress(rolesModuleAddress)) {
      throw new Error(`Invalid roles module address: ${rolesModuleAddress}`);
    }

    const tokenAddress = log.args.asset as Address;

    const savedData = await processTransactionLogCommon({
      client,
      blockNumber,
      transactionHash,
      getSafeAddress: async () => {
        return await getGnosisPaySafeAddressFromModule({
          rolesModuleAddress,
          blockNumber,
          client,
        });
      },
      tokenAddress,
      amountRaw: spendAmountRaw,
      transactionType: GnosisPayTransactionType.Spend,
      mongooseModels,
      blockInfoProvider,
      redisCache,
    });

    return {
      data: savedData,
      error: null,
    };
  } catch (e) {
    return {
      data: null,
      error: e as Error,
    };
  }
}

export async function processRefundLog(
  params:
    & ProcessLogFunctionParams<
      Awaited<ReturnType<typeof getGnosisPayRefundLogs>>[number]
    >
    & { redisCache?: RedisCache },
) {
  const { client, log, mongooseModels, blockInfoProvider, redisCache } = params;
  try {
    await validateLogIsNotAlreadyProcessed(
      mongooseModels.gnosisPayTransactionModel,
      log.transactionHash,
    );

    const { blockNumber, transactionHash } = log;
    const safeAddress = log.args.to?.toLowerCase() as Address;

    if (!isAddress(safeAddress)) {
      throw new Error(`Invalid to address: ${safeAddress}`);
    }

    const amountRaw = log.args.value as bigint;
    if (amountRaw === undefined) {
      throw new Error('Amount is undefined');
    }

    const tokenAddress = log.address as Address;

    const savedData = await processTransactionLogCommon({
      client,
      blockNumber,
      transactionHash,
      getSafeAddress: () => Promise.resolve(safeAddress),
      tokenAddress,
      amountRaw,
      transactionType: GnosisPayTransactionType.Refund,
      mongooseModels,
      blockInfoProvider,
      redisCache,
    });

    return {
      data: savedData,
      error: null,
    };
  } catch (e) {
    return {
      data: null,
      error: e as Error,
    };
  }
}

async function validateLogIsNotAlreadyProcessed(
  model: CreateModelsReturnType['gnosisPayTransactionModel'],
  logId: string,
) {
  const savedLog = await model.findOne({ _id: logId });
  if (savedLog !== null) {
    throw new LogAlreadyProcessedError(`Log ${logId} already processed`);
  }
}

function validateToken(tokenAddress: Address) {
  // Verify that the token is registered as GP token like EURe, GBPe, and USDC
  const spentToken = getGnosisPayTokenByAddress(tokenAddress);

  if (!spentToken) {
    throw new Error(`Unknown token: ${tokenAddress}`, {
      cause: 'UNKNOWN_TOKEN',
    });
  }

  return spentToken;
}

async function getGnosisPaySafeOwners(
  params: Parameters<typeof getGnosisPaySafeOwnersCore>[0],
) {
  const { data: owners } = await getGnosisPaySafeOwnersCore(params);

  if (!owners) {
    throw new Error(`Owners not found for safe address ${params.safeAddress}`, {
      cause: 'OWNERS_NOT_FOUND',
    });
  }

  return owners;
}

async function getTokenUsdPrice(
  params:
    & { token: Address }
    & Omit<Parameters<typeof getOraclePriceAtBlockNumber>[0], 'oracle'>,
) {
  if (
    isAddressEqual(params.token, usdcBridgeToken.address) ||
    isAddressEqual(params.token, circleUsdcToken.address)
  ) {
    return 1;
  }

  // Custom finder for gno token
  const tokenInfo: GnoisPayTokenType | undefined = isAddressEqual(params.token, gnoToken.address)
    ? gnoToken
    : getGnosisPayTokenByAddress(params.token);

  if (!tokenInfo?.oracle) {
    throw new Error(
      `Token (${params.token}) either not found or not registered as GP token`,
    );
  }

  const { data, error } = await getOraclePriceAtBlockNumber({
    ...params,
    oracle: tokenInfo.oracle,
  });

  if (!data) {
    throw error;
  }

  return data.price;
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

async function saveToDatabase(
  mongooseModels: CreateModelsReturnType,
  transactionPayload: GnosisPayTransactionFieldsType,
  paySafePayload: {
    safeAddress: Address;
    owners: Address[];
    isOG: boolean;
  },
): Promise<ProcessLogFnDataType> {
  const executeTransaction = async () => {
    const {
      gnosisPayTransactionModel,
      safeWeekRewardsSnapshotModel,
      weekMetricsSnapshotModel,
      gnosisPaySafeModel,
    } = mongooseModels;
    const safeAddress = transactionPayload.safe.toLowerCase() as Address;
    const { token } = transactionPayload;
    const tokenAddress = typeof token === 'string'
      ? token.toLowerCase() as Address
      : token.address.toLowerCase() as Address;
    const { week } = transactionPayload;
    // Start a session to ensure atomicity
    const mongooseSession = await gnosisPayTransactionModel.startSession();
    mongooseSession.startTransaction();

    try {
      const transactionDocument = await new gnosisPayTransactionModel<
        GnosisPayTransactionFieldsType
      >({
        ...transactionPayload,
        token: tokenAddress,
        safe: safeAddress,
      }).save({ session: mongooseSession });

      // Update the week cashback reward document
      const weekRewardDocument = await createSafeWeekRewardsSnapshotDocument(
        safeWeekRewardsSnapshotModel,
        {
          week,
          address: safeAddress,
        },
        mongooseSession,
      );

      // Initialize the net usd volume field
      let prevNetVolumeUSD = weekRewardDocument.netVolumeUSD;

      // If this is the first transaction for the week,
      // we need to check if the previous week cashback net volume is in the negative
      // if it is negative, we need to carry the negative volume over to the new week
      if (weekRewardDocument.transactions.length === 0) {
        const prevWeekId = toWeekId(dayjs(week).subtract(1, 'week').unix());
        const prevDocumentId = safeWeekRewardsSnapshotModel.createDocumentId(
          prevWeekId,
          safeAddress,
        );
        const previousWeekCashbackReward = await safeWeekRewardsSnapshotModel
          .findById(prevDocumentId);

        if (
          previousWeekCashbackReward !== null &&
          previousWeekCashbackReward.netVolumeUSD < 0
        ) {
          prevNetVolumeUSD = previousWeekCashbackReward.netVolumeUSD;
        }
      }
      // Update the net usd volume field
      weekRewardDocument.netVolumeUSD = transactionPayload.type === GnosisPayTransactionType.Spend
        ? prevNetVolumeUSD + transactionPayload.valueUSD
        : prevNetVolumeUSD - transactionPayload.valueUSD;
      // Add the spend transaction to the week cashback reward document
      weekRewardDocument.transactions.push(transactionDocument._id);

      await weekRewardDocument.save({ session: mongooseSession });

      // All GnosisPay transactions for this safe address - only fetch required fields for netVolumeUSD calculation
      const existingTransactions = await gnosisPayTransactionModel
        .find({ safe: safeAddress })
        .select('type valueUSD') // Only select fields needed for calculateNetUsdVolume
        .lean();

      const allGnosisPayTransactions = [
        {
          type: transactionDocument.type,
          valueUSD: transactionDocument.valueUSD,
        }, // we include this manually since the document hasn't been saved to the database yet
        ...existingTransactions,
      ];

      // Create regular Gnosis Pay safe address document
      const gnosisPaySafeDocument = await createGnosisPaySafeDocument(
        gnosisPaySafeModel,
        paySafePayload,
        mongooseSession,
      );

      gnosisPaySafeDocument.transactions.push(transactionDocument._id);
      gnosisPaySafeDocument.netVolumeUSD = calculateNetVolumeUSD(
        allGnosisPayTransactions,
      );
      gnosisPaySafeDocument.owners = paySafePayload.owners;

      await gnosisPaySafeDocument.save({ session: mongooseSession });

      // Update the week metrics snapshot
      const weekMetricsOldSnapshot = await createWeekMetricsSnapshotDocument(
        weekMetricsSnapshotModel,
        {
          week,
        },
        mongooseSession,
      );
      // Add the spend transaction to the week metrics snapshot
      weekMetricsOldSnapshot.transactions.push(transactionDocument._id);
      const weekMetricsNewSnapshot = await weekMetricsOldSnapshot.save({
        session: mongooseSession,
      });

      await mongooseSession.commitTransaction();
      await mongooseSession.endSession();

      // Manually populate the token and safe fields
      const gnosisPayTransactionJsonData = (await transactionDocument.populate('token')).toJSON();

      return {
        gnosisPayTransaction: gnosisPayTransactionJsonData,
        safeWeekRewardsSnapshot: weekRewardDocument.toJSON(),
        weekMetricsSnapshot: weekMetricsNewSnapshot.toJSON(),
      };
    } catch (error) {
      // Abort transaction and end session on error
      await mongooseSession.abortTransaction();
      await mongooseSession.endSession();
      throw error;
    }
  };

  try {
    return await executeTransaction();
  } catch (error) {
    // Only retry on write conflict errors
    if (isWriteConflictError(error)) {
      return await retry(
        executeTransaction,
        {
          retries: 5,
          minTimeout: 50, // Start with 50ms
          maxTimeout: 1000, // Max 1 second between retries
          factor: 2, // Exponential backoff
          randomize: true, // Add jitter to reduce concurrent retries
        },
      );
    }
    // For non-write-conflict errors, throw immediately
    throw error;
  }
}
