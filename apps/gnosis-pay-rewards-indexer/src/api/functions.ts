import {
  calculateWeekRewardAmount,
  gCrcToken,
  GnosisPayTransactionFieldsType,
  gnoToken,
  metriRewards,
  moneriumEureToken,
  moneriumGbpToken,
  RewardTransactionFieldsType,
  SafeWeekRewardsSnapshotDocumentFieldsType,
  TokenBalanceSnapshotFieldsType,
  TokenFieldsType,
  toWeekId,
  WeekIdFormatType,
} from '@kpk/gnosis-pay-rewards-sdk';
import { GetMetriRewardsResponseType } from '@kpk/gnosis-pay-rewards-sdk/api';
import {
  createGnosisPaySafeDocument,
  createMetriSafeDocument,
  CreateModelsReturnType,
  createSafeWeekRewardsSnapshotDocument,
  SafeWeekRewardsSnapshotDocumentType,
} from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import { type Address, isAddress, isAddressEqual, parseUnits, type PublicClient, type Transport } from 'viem';
import { gnosis } from 'viem/chains';
import { isMetriSafeWithRedisCache } from '../process/token-transfer.ts';
import { isGnosisPaySafeAddress } from '../gp/isGnosisPaySafeAddress.ts';
import { getGnosisPaySafeOwners, getMetirSafeOwners } from '../gp/getGnosisPaySafeOwners.ts';
import { hasGnosisPayOgNft, hasGnosisPayOgNftV2 } from '../gp/hasGnosisPayOgNft.ts';
import { getGnosisPaySafeFromMetriSafe } from '../lib/metri/checkers.ts';
import { FilterQuery, Model } from 'mongoose';
import type { BlockInfoProvider } from '../lib/block-info-provider.ts';
import { HydratedDocument } from 'mongoose';
import { dayjsUtc } from '../lib/dayjs-utc.ts';
import {
  GetGnosisPaySafeWeekRewardsSummaryQueryZodSchemaType,
  GetRewardTransactionsQueryZodSchemaType,
  GetSafeWeekRewardsSnapshotQueryZodSchemaType,
} from './router-zod.ts';
import { Logger } from 'winston';
import { mongoosePaginateCustomLabels } from '@kpk/apps-sdk/api';
import { findLowestMetriWalletGnoBalance, TokenBalanceSnapshotWithTokenFieldsType } from './min-balance-functions.ts';
import { CachedTokenPriceProvider } from '../lib/cached-token-price-provider.ts';
import type { RedisCache } from '../lib/redis-cache.ts';
import { getCachedGcrcPrice } from '../lib/gcrc-price-timer.ts';
import { ensureTokenBalanceSnapshots } from './ensure-token-balance-snapshots.ts';
type GetSafeWeekRewardsSnapshotWithFallbackDeps = {
  client: PublicClient<Transport, typeof gnosis>;
  mongooseModels: CreateModelsReturnType;
  blockInfoProvider: BlockInfoProvider;
  redisCache: RedisCache;
};

function populateTokenBalanceSnapshots(
  document: HydratedDocument<SafeWeekRewardsSnapshotDocumentFieldsType>,
) {
  return document.populate<
    { tokenBalanceSnapshots: TokenBalanceSnapshotFieldsType[] }
  >({
    path: 'tokenBalanceSnapshots',
    select: 'block balance week token',
    populate: {
      path: 'token',
      select: 'address decimals symbol name',
    },
  });
}

/**
 * Carries over negative net USD volume from the previous week if the current week has no transactions
 */
async function carryOverNetUsdVolume(
  model: CreateModelsReturnType['safeWeekRewardsSnapshotModel'],
  document: SafeWeekRewardsSnapshotDocumentType,
  safeAddress: Address,
  week: WeekIdFormatType,
): Promise<void> {
  if (document.transactions.length > 0) {
    return;
  }

  const prevWeekId = toWeekId(dayjsUtc(week).subtract(1, 'week').unix());
  const prevDocumentId = model.createDocumentId(prevWeekId, safeAddress);
  const previousWeekRewardSnapshot = await model.findById(prevDocumentId);

  if (
    previousWeekRewardSnapshot !== null &&
    previousWeekRewardSnapshot.netVolumeUSD < 0
  ) {
    document.netVolumeUSD = previousWeekRewardSnapshot.netVolumeUSD;
    await document.save();
  }
}

/**
 * Creates or updates a Gnosis Pay Safe document with owners and OG NFT status
 */
async function ensureGnosisPaySafeDocument(
  deps: {
    client: PublicClient<Transport, typeof gnosis>;
    gnosisPaySafeModel: CreateModelsReturnType['gnosisPaySafeModel'];
  },
  safeAddress: Address,
): Promise<void> {
  const { data: safeOwners, error } = await getGnosisPaySafeOwners({
    safeAddress,
    client: deps.client,
  });

  if (error !== null || safeOwners.length === 0) {
    throw new Error('No owners found for this safe');
  }

  const isOG = [
    await hasGnosisPayOgNft(deps.client, safeOwners),
    await hasGnosisPayOgNftV2(deps.client, [safeAddress]),
  ]
    .some(
      (has) => has.some((addr) => addr === true),
    );

  await createGnosisPaySafeDocument(deps.gnosisPaySafeModel, {
    safeAddress,
    owners: safeOwners,
    isOG,
  });
}

export async function getGnosisPaySafeWeekRewardsSnapshotWithFallback(
  deps: GetSafeWeekRewardsSnapshotWithFallbackDeps,
  params: GetGnosisPaySafeWeekRewardsSummaryQueryZodSchemaType,
): Promise<HydratedDocument<SafeWeekRewardsSnapshotDocumentFieldsType>> {
  const { client } = deps;
  const {
    safeWeekRewardsSnapshotModel,
    gnosisPaySafeModel,
    tokenBalanceSnapshotModel,
  } = deps.mongooseModels;
  const { week } = params;
  const safeAddress = params.safe.toLowerCase() as Address;
  const documentId = safeWeekRewardsSnapshotModel.createDocumentId(
    week,
    safeAddress,
  );

  const getDocument = () =>
    (safeWeekRewardsSnapshotModel
      .findById(documentId)
      .populate('transactions')
      .populate(
        {
          path: 'earnedRewards',
          select: 'token transactionHash block amount valueUSD valueEUR valueGBP from recipient week',
          populate: {
            path: 'token',
            select: 'address decimals symbol name',
          },
        },
      )
      .populate<{ tokenBalanceSnapshots: TokenBalanceSnapshotFieldsType[] }>('tokenBalanceSnapshots', {
        select: 'block balance week token',
        populate: {
          path: 'token',
          select: 'address decimals symbol name',
        },
      })
      .populate('safe', {
        isOG: 1,
        address: 1,
      })) as unknown as SafeWeekRewardsSnapshotDocumentType & {
        earnedRewards: RewardTransactionFieldsType[] & { token: TokenFieldsType };
      };

  // Try to find the week reward document
  let document = await getDocument();

  // The document does not exist, meaning that the API request has to trigger the creation of the document
  if (document === null) {
    const { isGnosisPaySafe } = await isGnosisPaySafeAddress({
      address: safeAddress,
      client,
      gnosisPaySafeModel,
    });

    if (isGnosisPaySafe === false) {
      const error = new Error('Address is not a Gnosis Safe', {
        cause: 'NOT_GNOSIS_PAY_SAFE',
      });
      throw error;
    }

    const newWeekRewardSnapshotDocument = await createSafeWeekRewardsSnapshotDocument(
      safeWeekRewardsSnapshotModel,
      {
        week,
        address: safeAddress,
      },
    );

    await carryOverNetUsdVolume(
      safeWeekRewardsSnapshotModel,
      newWeekRewardSnapshotDocument,
      safeAddress,
      week,
    );
    await ensureGnosisPaySafeDocument(
      { client, gnosisPaySafeModel },
      safeAddress,
    );
    document = await getDocument();
  }

  // Ensure token balance snapshots exist
  await ensureTokenBalanceSnapshots(
    {
      tokenBalanceSnapshotModel,
      safeModel: gnosisPaySafeModel,
      safeWeekRewardsSnapshotModel,
      client,
      blockInfoProvider: deps.blockInfoProvider,
    },
    {
      safeAddress,
      tokenBalanceSnapshots: (document?.tokenBalanceSnapshots as unknown as TokenBalanceSnapshotFieldsType[]) ?? [],
    },
  );

  // Refresh document to get updated token balance snapshots
  document = await getDocument();
  if (document === null) {
    throw new Error('Failed to retrieve week rewards snapshot document');
  }

  const finalDocument = await populateTokenBalanceSnapshots(
    document as unknown as HydratedDocument<
      SafeWeekRewardsSnapshotDocumentFieldsType
    >,
  );

  // Type assertion needed because Mongoose populate changes the document type structure
  // The populated fields (tokenBalanceSnapshots) are typed as documents instead of strings
  return finalDocument as unknown as HydratedDocument<
    SafeWeekRewardsSnapshotDocumentFieldsType
  >;
}

/**
 * Ensures a Metri Safe document exists and is linked to its Gnosis Pay Safe if applicable
 */
async function ensureMetriSafeDocument(
  deps: {
    client: PublicClient<Transport, typeof gnosis>;
    metriSafeModel: CreateModelsReturnType['metriSafeModel'];
  },
  metriSafeAddress: Address,
): Promise<void> {
  const metriSafeDoc = await deps.metriSafeModel.findById(
    metriSafeAddress.toLowerCase() as Address,
  );

  // Get the current Gnosis Pay safe address from the Metri safe address
  const gnosisPaySafe = await getGnosisPaySafeFromMetriSafe(
    metriSafeAddress,
  );

  // If the Metri safe document exists, update the gnosis pay safe address
  if (metriSafeDoc !== null) {
    metriSafeDoc.gnosisPaySafe = gnosisPaySafe?.toLowerCase() as Address | null;
    await metriSafeDoc.save();
    return;
  }

  // Get the Metri safe owners
  const metirSafeOwners = await getMetirSafeOwners({
    client: deps.client,
    safeAddress: metriSafeAddress,
  });

  // Document doesn't exist - create it
  await createMetriSafeDocument(deps.metriSafeModel, {
    safeAddress: metriSafeAddress,
    owners: metirSafeOwners,
    gnosisPaySafe,
  });
}

type SafeBaseicFieldsType = {
  address: Address;
  isOG: boolean;
  owners: Address[];
};

export async function getMetriSafeWeekRewardsSnapshotWithFallback(
  deps: GetSafeWeekRewardsSnapshotWithFallbackDeps,
  params: GetSafeWeekRewardsSnapshotQueryZodSchemaType,
) {
  const { client } = deps;
  const {
    safeWeekRewardsSnapshotModel,
    metriSafeModel,
    tokenBalanceSnapshotModel,
  } = deps.mongooseModels;
  const { week } = params;
  const metriSafeAddress = params.safe.toLowerCase() as Address;
  const documentId = safeWeekRewardsSnapshotModel.createDocumentId(
    week,
    metriSafeAddress,
  );

  // Check if address is a Metri Safe
  const addressIsMetriSafe = await isMetriSafeWithRedisCache(metriSafeAddress, deps.redisCache);

  if (addressIsMetriSafe === false) {
    throw new Error(`Address (${metriSafeAddress}) is not a Metri Safe`, {
      cause: 'NOT_METRI_SAFE',
    });
  }

  const getDocument = () =>
    safeWeekRewardsSnapshotModel
      .findById(documentId)
      .populate<{ transactions: GnosisPayTransactionFieldsType[] }>(
        'transactions',
      )
      .populate(
        {
          path: 'earnedRewards',
          select: 'token transactionHash block amount valueUSD valueEUR valueGBP from recipient week',
          populate: {
            path: 'token',
            select: 'address decimals symbol name',
          },
        },
      )
      .populate<{ tokenBalanceSnapshots: TokenBalanceSnapshotFieldsType[] }>({
        path: 'tokenBalanceSnapshots',
        select: 'block balance week token',
        populate: {
          path: 'token',
          select: 'address decimals symbol name',
        },
      })
      .populate<{
        safe: SafeBaseicFieldsType & {
          gnosisPaySafe: SafeBaseicFieldsType | null;
        };
      }>({
        path: 'safe',
        model: metriSafeModel as unknown as Model<unknown>,
        select: 'address isOG owners',
        populate: {
          path: 'gnosisPaySafe',
          select: 'address isOG owners',
        },
      });

  // Try to find the week reward document
  let weekRewardSnapshotDocument = await getDocument();

  // The document does not exist, meaning that the API request has to trigger the creation of the document
  if (weekRewardSnapshotDocument === null) {
    await createSafeWeekRewardsSnapshotDocument(safeWeekRewardsSnapshotModel, {
      week,
      address: metriSafeAddress,
    });

    weekRewardSnapshotDocument = await getDocument();
  }

  // Ensure the metri safe document exists in the database
  // This is needed even if the week reward document already exists
  await ensureMetriSafeDocument({ client, metriSafeModel }, metriSafeAddress);
  // Ensure token balance snapshots exist
  await ensureTokenBalanceSnapshots(
    {
      tokenBalanceSnapshotModel,
      safeModel: metriSafeModel,
      safeWeekRewardsSnapshotModel,
      client,
      blockInfoProvider: deps.blockInfoProvider,
    },
    {
      safeAddress: metriSafeAddress,
      // Type assertion needed because populated document types differ from base types
      tokenBalanceSnapshots: weekRewardSnapshotDocument?.tokenBalanceSnapshots ?? [],
      snapshotTokens: [gnoToken],
    },
  );

  // Refresh the document to ensure populate works correctly
  weekRewardSnapshotDocument = await getDocument();
  if (weekRewardSnapshotDocument === null) {
    throw new Error('Failed to retrieve week rewards snapshot document');
  }

  // Aggregate GNO balances from both Metri safe and linked Gnosis Pay safe if applicable

  // Type assertion needed because Mongoose populate changes the document type structure
  // The populated fields (transactions, tokenBalanceSnapshots) are typed as documents instead of strings
  return weekRewardSnapshotDocument as unknown as HydratedDocument<
    Omit<SafeWeekRewardsSnapshotDocumentFieldsType, 'safe'> & {
      safe: SafeBaseicFieldsType & { gnosisPaySafe: SafeBaseicFieldsType | null };
    }
  >;
}

export function findRewardTransactions(
  model: CreateModelsReturnType['rewardTransactionModel'],
  params: GetRewardTransactionsQueryZodSchemaType,
) {
  const { address, week, 'from-address': fromAddress, 'to-address': toAddress, token, limit, page } = params;
  const filterQuery = buildFilterQuery<RewardTransactionFieldsType>({
    address,
    week,
    from: fromAddress,
    to: toAddress,
    token,
  });

  return model.paginate(filterQuery, {
    customLabels: mongoosePaginateCustomLabels,
    lean: true,
    limit,
    page,
  });
}

/**
 * Calculates the minimum token balance for each token from token balance snapshots
 * @param tokenBalanceSnapshots - Array of populated token balance snapshots
 * @returns Record mapping token address to minimum balance
 */
export function toMinAndMaxTokenBalancesMap(
  tokenBalanceSnapshots: (Omit<TokenBalanceSnapshotFieldsType, 'token'> & {
    token: TokenFieldsType;
  })[],
): {
  minTokenBalance: Record<Address, number>;
  maxTokenBalance: Record<Address, number>;
} {
  const minTokenBalance: Record<string, number> = {};
  const maxTokenBalance: Record<string, number> = {};

  for (const snapshot of tokenBalanceSnapshots) {
    const tokenAddressRaw = snapshot?.token?.address;

    if (!tokenAddressRaw) {
      continue; // Skip snapshots without a token address
    }

    const tokenAddress = tokenAddressRaw.toLowerCase() as Address;

    if (!isAddress(tokenAddress)) {
      throw new Error(`Invalid token address: ${tokenAddress}`);
    }

    if (
      minTokenBalance[tokenAddress] === undefined ||
      snapshot.balance < minTokenBalance[tokenAddress]
    ) {
      minTokenBalance[tokenAddress] = snapshot.balance;
    }
    if (
      maxTokenBalance[tokenAddress] === undefined ||
      snapshot.balance > maxTokenBalance[tokenAddress]
    ) {
      maxTokenBalance[tokenAddress] = snapshot.balance;
    }
  }

  return {
    minTokenBalance,
    maxTokenBalance,
  };
}

export function buildFilterQuery<T>(params?: Record<string, unknown>): FilterQuery<T> {
  return Object.fromEntries(
    Object.entries(params || {}).filter(([key, value]) => value !== undefined && key !== '_id'),
  ) as FilterQuery<T>;
}

export function addTokenInfoToEarnedReward(earnedReward: RewardTransactionFieldsType, tokenInfo: TokenFieldsType) {
  // token is missing from the earned rewards
  if (earnedReward.token === undefined) {
    return {
      ...earnedReward,
      token: tokenInfo,
    };
  }

  return earnedReward;
}

type HandleRewardsRequestParams = {
  getSnapshot: () => Promise<
    | Awaited<ReturnType<typeof getMetriSafeWeekRewardsSnapshotWithFallback>>
    | Awaited<ReturnType<typeof getGnosisPaySafeWeekRewardsSnapshotWithFallback>>
  >;
  isMetriSafe: boolean;
  client: PublicClient<Transport, typeof gnosis>;
  logger: Logger | undefined;
  mongooseModels: CreateModelsReturnType;
  redisCache: RedisCache;
  fallbackToken: TokenFieldsType;
};

/**
 * Shared handler for rewards endpoints that accepts a callback to get the snapshot
 */
export async function handleRewardsRequest(params: HandleRewardsRequestParams) {
  const { getSnapshot, isMetriSafe, client, mongooseModels, redisCache, fallbackToken } = params;

  const safeWeekRewardsSnapshotDoc = await getSnapshot();

  // Get populated snapshots from the document before serialization
  // This ensures we have the actual populated objects, not IDs
  let populatedSnapshots =
    (safeWeekRewardsSnapshotDoc?.tokenBalanceSnapshots as unknown as TokenBalanceSnapshotWithTokenFieldsType[]) || [];

  // Track the lowest GNO balance if we calculate it (for Metri safes with Pay safe)
  let lowestGnoBalance = 0;
  let hasCalculatedGnoBalance = false;

  // For Metri safes, aggregate GNO balances from both Metri safe and linked Gnosis Pay safe
  if (isMetriSafe) {
    const safe = safeWeekRewardsSnapshotDoc?.safe as unknown as {
      isOG?: boolean;
      gnosisPaySafe?: { address?: Address; isOG?: boolean } | null;
    };
    const gnosisPaySafeAddress = safe?.gnosisPaySafe?.address || null;
    const safeAddress = (safeWeekRewardsSnapshotDoc?.safe as unknown as { address?: Address })?.address;
    const week = safeWeekRewardsSnapshotDoc?.week;
    if (gnosisPaySafeAddress && safeAddress && week) {
      // Find the lowest GNO balance considering movement from Pay safe to Metri safe
      lowestGnoBalance = await findLowestMetriWalletGnoBalance({
        metriSafeAddress: safeAddress,
        gnosisPaySafeAddress,
        week,
        tokenBalanceSnapshotModel: mongooseModels.tokenBalanceSnapshotModel,
      });
      hasCalculatedGnoBalance = true;

      // Remove GNO snapshots from populatedSnapshots since we'll use the calculated minimum
      const gnoTokenAddress = gnoToken.address.toLowerCase() as Address;
      populatedSnapshots = populatedSnapshots.filter(
        (snapshot) => {
          const tokenAddress = (snapshot.token as TokenFieldsType)?.address;
          return tokenAddress && isAddressEqual(tokenAddress, gnoTokenAddress) === false;
        },
      );
    }
  }

  // Final data to return to the client
  const safeWeekRewardsSnapshotJson = safeWeekRewardsSnapshotDoc?.toJSON();
  // @ts-expect-error ignore
  safeWeekRewardsSnapshotJson.earnedRewards = safeWeekRewardsSnapshotJson.earnedRewards.map((er) => {
    return addTokenInfoToEarnedReward(er as never, fallbackToken);
  });

  // Replace tokenBalanceSnapshots in JSON with populated snapshots (excluding GNO if we calculated it)
  (safeWeekRewardsSnapshotJson as unknown as {
    tokenBalanceSnapshots: TokenBalanceSnapshotWithTokenFieldsType[];
  }).tokenBalanceSnapshots = populatedSnapshots;

  // Calculate estimated rewards based on minimum GNO balance
  const { minTokenBalance, maxTokenBalance } = toMinAndMaxTokenBalancesMap(populatedSnapshots);

  // Add the lowest GNO balance if we calculated it (always add it, even if 0)
  if (hasCalculatedGnoBalance) {
    const gnoTokenAddress = gnoToken.address.toLowerCase() as Address;
    minTokenBalance[gnoTokenAddress] = lowestGnoBalance;
  }
  const resturnValue = {
    ...safeWeekRewardsSnapshotJson,
    minTokenBalance,
    maxTokenBalance,
    estimatedRewards: [],
  } as {
    estimatedRewards: GetMetriRewardsResponseType['data']['estimatedRewards'];
    minTokenBalance: Record<Address, number>;
    maxTokenBalance: Record<Address, number>;
  };

  const minGnoBalance = resturnValue.minTokenBalance[gnoToken.address.toLowerCase()] || 0;

  if (minGnoBalance === 0) {
    return resturnValue;
  }

  let gnosisPaySafeNetVolumeUSD = safeWeekRewardsSnapshotJson.netVolumeUSD || 0;
  const safe = safeWeekRewardsSnapshotJson.safe as {
    isOG?: boolean;
    gnosisPaySafe?: { address?: Address; isOG?: boolean } | null;
  };
  const week = safeWeekRewardsSnapshotJson.week;
  // Get current block number for price provider
  const currentBlock = await client.getBlockNumber();
  const priceProvider = new CachedTokenPriceProvider(client, redisCache);

  // Try to get cached gCRC price first (from timer), fall back to fetching if not available
  let crcPrice = await getCachedGcrcPrice(redisCache);
  if (crcPrice === null || crcPrice <= 0) {
    // Fall back to fetching if cache is empty
    crcPrice = await priceProvider.price({ tokenA: gCrcToken, blockNumber: currentBlock });
  }

  const prices = {
    EURUSD: await priceProvider.price({ tokenA: moneriumEureToken, blockNumber: currentBlock }),
    GBPUSD: await priceProvider.price({ tokenA: moneriumGbpToken, blockNumber: currentBlock }),
    GNOUSD: await priceProvider.price({ tokenA: gnoToken, blockNumber: currentBlock }),
    CRCUSD: crcPrice,
  };

  if (isMetriSafe) {
    // For Metri safes, use the linked Gnosis Pay safe's netVolumeUSD
    const gnosisPaySafeAddress = safe?.gnosisPaySafe?.address;

    if (gnosisPaySafeAddress) {
      // Fetch the Gnosis Pay safe's week rewards snapshot to get its netVolumeUSD
      const gnosisPaySafeDocumentId = mongooseModels.safeWeekRewardsSnapshotModel.createDocumentId(
        week,
        gnosisPaySafeAddress,
      );
      const gnosisPaySafeSnapshot = await mongooseModels.safeWeekRewardsSnapshotModel
        .findById(gnosisPaySafeDocumentId).select('netVolumeUSD')
        .lean();

      gnosisPaySafeNetVolumeUSD = gnosisPaySafeSnapshot?.netVolumeUSD ?? 0;
    }

    const isOgNftHolder = safe?.isOG === true;

    // Convert gnosisPaySafeNetVolumeUSD to EUR, per the program's rules
    const gnosisPaySafeNetVolumeEUR = gnosisPaySafeNetVolumeUSD / prices.EURUSD;

    const rewardResult = metriRewards.calculateMetriWeekRewardAmount({
      weekVolumeEUR: gnosisPaySafeNetVolumeEUR,
      gnoBalance: minGnoBalance,
      isOgNftHolder,
    });

    if (rewardResult.rewardAmountCrc > 0) {
      const amount = rewardResult.rewardAmountCrc;
      const amountRaw = parseUnits(amount.toString(), gCrcToken.decimals).toString();
      const tokenPriceUSD = prices.CRCUSD;
      const tokenPriceEUR = tokenPriceUSD / prices.EURUSD;
      const tokenPriceGBP = tokenPriceUSD / prices.GBPUSD;
      resturnValue.estimatedRewards.push({
        amount,
        amountRaw,
        token: gCrcToken as never,
        tokenPriceEUR,
        tokenPriceUSD,
        tokenPriceGBP,
        valueUSD: amount * tokenPriceUSD,
        valueEUR: amount * tokenPriceEUR,
        valueGBP: amount * tokenPriceGBP,
        valuePercentage: rewardResult.rewardAmountPercentage,
      });
    }
  } else {
    // For Gnosis Pay safes, use standard reward calculation
    const isOgNftHolder = safe?.isOG === true;

    const rewardResult = calculateWeekRewardAmount({
      weekUsdVolume: gnosisPaySafeNetVolumeUSD,
      gnoBalance: minGnoBalance,
      gnoUsdPrice: prices.GNOUSD,
      isOgNftHolder,
    });

    if (rewardResult.rewardAmountGno > 0) {
      const amount = rewardResult.rewardAmountGno;
      const amountRaw = parseUnits(amount.toString(), gnoToken.decimals).toString();
      const tokenPriceUSD = prices.GNOUSD;
      const tokenPriceEUR = tokenPriceUSD / prices.EURUSD;
      const tokenPriceGBP = tokenPriceUSD / prices.GBPUSD;
      resturnValue.estimatedRewards.push({
        amount,
        amountRaw,
        token: gnoToken as never,
        tokenPriceUSD,
        tokenPriceEUR,
        tokenPriceGBP,
        valueUSD: amount * tokenPriceUSD,
        valueEUR: amount * tokenPriceEUR,
        valueGBP: amount * tokenPriceGBP,
        valuePercentage: rewardResult.rewardAmountPercentage,
      });
    }
  }

  return resturnValue;
}
