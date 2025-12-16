import {
  createGnosisTokenBalanceSnapshotDocument,
  createSafeWeekRewardsSnapshotDocument,
  GnosisPaySafeModelType,
  MetriSafeModelType,
  SafeWeekRewardsSnapshotModelType,
  TokenBalanceSnapshotModelType,
} from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import {
  getTokenBalanceOf,
  GnoisPayTokenType,
  TokenBalanceSnapshotFieldsType,
  tokenBalanceSnapshotTokens,
  TokenFieldsType,
  toWeekId,
} from '@kpk/gnosis-pay-rewards-sdk';
import { Address, formatUnits, isAddress } from 'viem';

import type { RedisCache } from '../lib/redis-cache.ts';
import type { GnosisChainPublicClient } from './types.ts';
import type { TokenTransferLogType } from '../gp/getTokenTransferLogs.ts';
import type { BlockInfoProvider } from '../lib/block-info-provider.ts';
import { getGnosisPaySafeOwners } from '../gp/getGnosisPaySafeOwners.ts';
import { isGnosisPaySafeAddress } from '../gp/isGnosisPaySafeAddress.ts';
import { isMetriSafe as isMetriSafeCore } from '../lib/metri/checkers.ts';

/**
 * Internal function to check if an address is a Metri Safe with Redis caching.
 * @param safeAddress - The safe address to check
 * @param redisCache - The Redis cache instance to use for caching
 * @returns Promise<boolean> - True if the address is a Metri Safe, false otherwise
 */
export async function isMetriSafeWithRedisCache(
  safeAddress: Address,
  redisCache: RedisCache,
): Promise<boolean> {
  const cacheKey = `isMetriSafe:${safeAddress.toLowerCase()}`;

  // Check cache first
  const cached = await redisCache.get<boolean>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  // If not in cache, call the core function
  const result = await isMetriSafeCore(safeAddress);

  // Cache the result (no expiry)
  await redisCache.set(cacheKey, result);

  return result;
}

type MongooseModels = {
  gnosisPaySafeModel: GnosisPaySafeModelType;
  metriSafeModel: MetriSafeModelType;
  tokenBalanceSnapshotModel: TokenBalanceSnapshotModelType;
  safeWeekRewardsSnapshotModel: SafeWeekRewardsSnapshotModelType;
};

type ProcessGnosisTokenTransferLogParams = {
  client: GnosisChainPublicClient;
  log: TokenTransferLogType;
  mongooseModels: MongooseModels;
  blockInfoProvider: BlockInfoProvider;
  redisCache: RedisCache;
};

export async function processGnosisTokenTransferLog(
  params: ProcessGnosisTokenTransferLogParams,
) {
  const { client, log, mongooseModels } = params;
  try {
    const { blockNumber } = log;
    const {
      gnosisPaySafeModel,
      metriSafeModel,
      tokenBalanceSnapshotModel,
      safeWeekRewardsSnapshotModel,
    } = mongooseModels;

    // Validate that log.args exists and has the expected structure
    if (!log.args || typeof log.args !== 'object') {
      throw new Error(`Log args are missing or invalid for transaction ${log.transactionHash}`, {
        cause: 'INVALID_LOG_ARGS',
      });
    }

    const { from, to } = log.args;

    // Check if from and to are defined
    if (from === undefined || to === undefined) {
      throw new Error(
        `Missing from or to address in log args for transaction ${log.transactionHash}. Args: ${
          JSON.stringify(log.args)
        }`,
        {
          cause: 'INVALID_SENDER_OR_RECEIVER_ADDRESS',
        },
      );
    }

    if (!isAddress(from as `0x${string}`) || !isAddress(to as `0x${string}`)) {
      throw new Error(`Invalid sender (${from}) or receiver (${to}) address`, {
        cause: 'INVALID_SENDER_OR_RECEIVER_ADDRESS',
      });
    }

    const sender = from as `0x${string}`;
    const receiver = to as `0x${string}`;

    // Build array of addresses that need token snapshots
    const snapshotTargets: Array<{
      address: Address;
      safeModel: GnosisPaySafeModelType | MetriSafeModelType;
    }> = [];

    // Track addresses to avoid duplicates
    const existingAddresses = new Set<Address>();

    // Loop through sender and receiver and add to snapshot targets
    const addressesToProcess = [
      sender.toLowerCase() as Address,
      receiver.toLowerCase() as Address,
    ].filter((addr, index, arr) => arr.indexOf(addr) === index); // Remove duplicates

    for (const address of addressesToProcess) {
      const isGnosisPaySafeResult = await isGnosisPaySafeAddress({
        address,
        client,
        gnosisPaySafeModel,
      });

      // Target is a Gnosis Pay Safe
      if (isGnosisPaySafeResult.isGnosisPaySafe) {
        snapshotTargets.push({ address, safeModel: gnosisPaySafeModel });
        existingAddresses.add(address);

        // Resolve owners and add to snapshot targets
        const getGnosisPaySafeOwnersResult = await getGnosisPaySafeOwners({
          client,
          safeAddress: address,
          blockNumber,
        });

        if (getGnosisPaySafeOwnersResult.error) {
          throw getGnosisPaySafeOwnersResult.error;
        }

        // Link Metri Safes and get the list of Metri Safe owners
        await linkMetriSafesToGnosisPaySafe(
          {
            client,
            gnosisPaySafeModel,
            metriSafeModel,
            redisCache: params.redisCache,
          },
          address,
          getGnosisPaySafeOwnersResult.data ?? [],
        );
      } else {
        // Not a Gnosis Pay Safe, check if it's a Metri Safe
        const isMetriSafe = await isMetriSafeWithRedisCache(address, params.redisCache);
        if (isMetriSafe && !existingAddresses.has(address)) {
          snapshotTargets.push({ address, safeModel: metriSafeModel });
          existingAddresses.add(address);
        }
      }
    }

    // Take token snapshots for all targets and all tokens in parallel
    await Promise.all(
      snapshotTargets.flatMap(({ address, safeModel }) =>
        tokenBalanceSnapshotTokens.map((token) =>
          takeTokenBalanceSnapshot(
            {
              tokenBalanceSnapshotModel,
              safeWeekRewardsSnapshotModel,
              client,
              safeModel,
              blockInfoProvider: params.blockInfoProvider,
            },
            {
              address,
              token,
              blockNumber,
            },
          ).catch((error) => {
            // Log error but don't throw - snapshot failures for individual safes/tokens shouldn't break the flow
            console.error(
              `Failed to take token snapshot for ${address} token ${token.symbol}:`,
              error,
            );
          })
        )
      ),
    );

    // Return success - snapshots have been taken
    const processedAddresses = snapshotTargets.map((target) => target.address);
    const metriSafeCount = snapshotTargets.filter(
      (target) => target.safeModel === metriSafeModel,
    ).length;
    return {
      data: {
        processedAddresses,
        metriSafeOwners: metriSafeCount,
        snapshotsTaken: snapshotTargets.length,
      },
      error: null,
    };
  } catch (e) {
    return {
      data: null,
      error: e as Error,
    };
  }
}

async function checkIfTokenSnapshotExists(
  tokenBalanceSnapshotModel: TokenBalanceSnapshotModelType,
  blockNumber: bigint,
  safeAddress: Address,
  tokenAddress: Address,
): Promise<TokenBalanceSnapshotFieldsType | null> {
  const docId = tokenBalanceSnapshotModel.createDocumentId(
    Number(blockNumber),
    safeAddress,
    tokenAddress,
  );

  const document = await tokenBalanceSnapshotModel.findById(docId).lean();
  return document as TokenBalanceSnapshotFieldsType | null;
}

type TakeGnosisTokenBalanceSnapshotDeps = {
  safeModel: GnosisPaySafeModelType | MetriSafeModelType;
  tokenBalanceSnapshotModel: TokenBalanceSnapshotModelType;
  safeWeekRewardsSnapshotModel: SafeWeekRewardsSnapshotModelType;
  client: GnosisChainPublicClient;
  blockInfoProvider: BlockInfoProvider;
};

type TakeGnosisTokenBalanceSnapshotParams = {
  address: Address;
  blockNumber?: bigint;
  token: TokenFieldsType | GnoisPayTokenType;
};

export async function takeTokenBalanceSnapshot(
  deps: TakeGnosisTokenBalanceSnapshotDeps,
  params: TakeGnosisTokenBalanceSnapshotParams,
): Promise<TokenBalanceSnapshotFieldsType | null> {
  const {
    tokenBalanceSnapshotModel,
    safeModel,
    safeWeekRewardsSnapshotModel,
    client,
    blockInfoProvider,
  } = deps;
  const { address, token } = params;

  const blockNumber = params.blockNumber ?? (await client.getBlockNumber());

  // Skip token snapshot if the token has a deploymentBlock and the current block is before deployment
  if (typeof token !== 'string' && token.deploymentBlock !== undefined) {
    if (Number(blockNumber) <= token.deploymentBlock) {
      // Token not deployed yet at this block, skip snapshot
      return null;
    }
  }

  const tokenAddress = typeof token === 'string' ? token : token.address;
  
  // Check if snapshot already exists - if so, return it instead of creating a duplicate
  const existingSnapshot = await checkIfTokenSnapshotExists(
    tokenBalanceSnapshotModel,
    blockNumber,
    address,
    tokenAddress as Address,
  );

  if (existingSnapshot !== null) {
    // Snapshot already exists, return it
    return existingSnapshot;
  }

  const block = await blockInfoProvider.getBlockInfo(Number(blockNumber));

  const tokenDecimals = typeof token === 'string' ? 18 : token.decimals;
  const balanceRaw = await getTokenBalanceOf({
    token: tokenAddress as Address,
    address,
    client,
    blockNumber,
  });

  const weekId = toWeekId(block.timestamp);

  // Create the Token Balance Snapshot document
  const tokenBalanceSnapshotDocument = await createGnosisTokenBalanceSnapshotDocument(tokenBalanceSnapshotModel, {
    block: Number(block.number),
    address,
    balance: Number(formatUnits(balanceRaw, tokenDecimals)),
    balanceRaw: balanceRaw.toString(),
    week: weekId,
    token: tokenAddress as Address,
  });

  // Create or load the Week Cashback Reward document
  // to append the new balance snapshot to
  const weekCashbackRewardDocument = await createSafeWeekRewardsSnapshotDocument(safeWeekRewardsSnapshotModel, {
    week: weekId,
    address,
  });

  await weekCashbackRewardDocument.addTokenBalanceSnapshotId(
    tokenBalanceSnapshotDocument._id,
    { save: true },
  );

  // @ts-expect-error - safeModel is a union type, but we know it's a GnosisPaySafeModelType or MetriSafeModelType
  await safeModel.updateOne(
    { _id: address },
    {
      $push: {
        tokenBalanceSnapshots: tokenBalanceSnapshotDocument._id,
      },
    },
  );

  return tokenBalanceSnapshotDocument;
}

export type LinkMetriSafesToGnosisPaySafeDeps = {
  gnosisPaySafeModel: GnosisPaySafeModelType;
  metriSafeModel: MetriSafeModelType;
  client: GnosisChainPublicClient;
  redisCache: RedisCache;
};

/**
 * Links Metri Safes to a Gnosis Pay Safe by checking if any of the Gnosis Pay Safe owners are Metri Safes
 * and updating the Metri Safe documents to reference the Gnosis Pay Safe.
 * @returns Array of Metri Safe owner addresses that were linked
 */
export async function linkMetriSafesToGnosisPaySafe(
  deps: LinkMetriSafesToGnosisPaySafeDeps,
  paySafeAddress: Address,
  paySafeOwners: Address[],
): Promise<Address[]> {
  const { metriSafeModel } = deps;

  paySafeAddress = paySafeAddress.toLowerCase() as Address;

  const normalizedOwners = paySafeOwners.map((owner) => owner.toLowerCase() as Address);

  // Check which owners are Metri Safes
  const metriSafeChecks = await Promise.all(
    normalizedOwners.map(async (ownerAddress) => {
      const isMetri = await isMetriSafeWithRedisCache(ownerAddress, deps.redisCache);
      return { ownerAddress, isMetri };
    }),
  );

  // Filter to only Metri Safes
  const metriSafeOwners = metriSafeChecks.filter(({ isMetri }) => isMetri).map((
    { ownerAddress },
  ) => ownerAddress);

  if (metriSafeOwners.length === 0) {
    // No Metri Safes found among owners
    return [];
  }

  // Update each Metri Safe document to link it to the Gnosis Pay Safe
  // Use updateMany with upsert: false to only update existing documents
  await metriSafeModel.updateMany(
    {
      _id: { $in: metriSafeOwners.map((addr) => addr.toLowerCase()) },
      // Only update if gnosisPaySafe is not already set or is different
      $or: [{ gnosisPaySafe: null }, {
        gnosisPaySafe: { $ne: paySafeAddress },
      }],
    },
    {
      $set: {
        gnosisPaySafe: paySafeAddress,
      },
    },
  );

  return metriSafeOwners;
}
