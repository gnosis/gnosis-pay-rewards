import {
  getTokenPricesAtBlockNumber,
  toWeekId,
  GnosisPayTokenPriceDocumentFieldsType,
} from '@karpatkey/gnosis-pay-rewards-sdk';
import {
  WeekCashbackRewardModelType,
  GnosisTokenBalanceSnapshotModelType,
  GnosisPaySafeAddressModelType,
  WeekMetricsSnapshotModelType,
  TokenModelType,
  GnosisPayTokenPriceModelType,
  createGnosisPayTokenPriceDocumentId,
} from '@karpatkey/gnosis-pay-rewards-sdk/mongoose';
import retry from 'async-retry';
import { isAddressEqual } from 'viem';
import { Logger } from 'winston';

import { GnosisChainPublicClient } from './process/types.js';
import { takeGnosisTokenBalanceSnapshot } from './process/processGnosisTokenTransferLog.js';
import { buildRetryOptions } from './gp/commons.js';
import { GNOSIS_TOKEN_SNAPSHOT_BLOCK_INTERVAL, TOKEN_PRICE_SNAPSHOT_BLOCK_INTERVAL } from './config/env.js';
import { getBlockByNumber } from './getBlockByNumber.js';
import dayjs from 'dayjs';

type HandleBlockParamsType = {
  blockNumber: bigint;
  client: GnosisChainPublicClient;
  logger: Logger;
  mongooseModels: {
    weekMetricsSnapshotModel: WeekMetricsSnapshotModelType;
    gnosisPaySafeAddressModel: GnosisPaySafeAddressModelType;
    gnosisTokenBalanceSnapshotModel: GnosisTokenBalanceSnapshotModelType;
    weekCashbackRewardModel: WeekCashbackRewardModelType;
    gnosisPayTokenModel: TokenModelType;
    gnosisPayTokenPriceModel: GnosisPayTokenPriceModelType;
  };
};

/**
 * Handle a week gnosis token balance snapshots
 * @param params - The parameters for handling the week
 */
async function handleBlockGnosisTokenBalanceSnapshots({
  blockNumber,
  client,
  logger,
  mongooseModels,
}: HandleBlockParamsType) {
  const childLogger = logger.child({
    function: 'handleBlockGnosisTokenBalanceSnapshots',
  });

  if (blockNumber % GNOSIS_TOKEN_SNAPSHOT_BLOCK_INTERVAL !== 0n) {
    return;
  }

  const { data: block } = await getBlockByNumber({
    blockNumber,
    client,
  });

  if (!block?.timestamp) {
    childLogger.info(`block timestamp is not defined, skipping`);
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
      isAddressEqual(snapshot.safe, safeAddress),
    );

    if (!doesHaveGnosisTokenBalanceSnapshot) {
      childLogger.info(`taking gnosis token balance snapshot for safe address ${safeAddress} for week ${weekId}`);

      await takeGnosisTokenBalanceSnapshot({
        ...mongooseModels,
        blockNumber,
        client,
        safeAddress,
      });
    }
  }
}

/**
 * Records token prices for all tokens that have oracle addresses
 */
export async function handleTokenPriceRecording({
  blockNumber,
  client,
  logger,
  mongooseModels,
}: HandleBlockParamsType) {
  if (blockNumber % TOKEN_PRICE_SNAPSHOT_BLOCK_INTERVAL !== 0n) {
    return;
  }

  const childLogger = logger.child({
    function: 'handleTokenPriceRecording',
  });

  const { data: block } = await getBlockByNumber({
    blockNumber,
    client,
  });

  if (!block?.timestamp) {
    childLogger.info(`block number or timestamp is not defined, skipping`);
    return;
  }

  // Get all tokens that have oracle addresses
  const tokens = await mongooseModels.gnosisPayTokenModel.find().lean();

  const { data: tokensWithPrices, error } = await getTokenPricesAtBlockNumber({
    client,
    blockNumber,
    tokens: tokens.map((token) => ({
      ...token,
      address: token._id,
    })),
  });

  if (error) {
    childLogger.error(`error getting token prices at block ${blockNumber}: ${error}`);
    return;
  }

  const tokenPricesDocumentsToSave = tokensWithPrices.map((tokenWithPrice) => ({
    _id: createGnosisPayTokenPriceDocumentId(Number(blockNumber), tokenWithPrice.address) as `${number}/0x${string}`,
    price: tokenWithPrice.price,
    blockNumber: Number(blockNumber),
    blockTimestamp: Number(block.timestamp),
    blockTimestampIso: dayjs.unix(Number(block.timestamp)).toDate(),
    token: tokenWithPrice.address,
  }));

  const savedTokenPricesDocuments =
    await mongooseModels.gnosisPayTokenPriceModel.create<GnosisPayTokenPriceDocumentFieldsType>(
      tokenPricesDocumentsToSave,
    );

  return savedTokenPricesDocuments;
}

/**
 * Handle a block
 * @param params - The parameters for handling the block
 */
export async function handleBlock({ blockNumber, client, logger, mongooseModels }: HandleBlockParamsType) {
  try {
    await retry(
      () => handleBlockGnosisTokenBalanceSnapshots({ blockNumber, client, logger, mongooseModels }),
      buildRetryOptions({
        name: 'handleBlockGnosisTokenBalanceSnapshots',
        logger,
      }),
    );

    await retry(
      () => handleTokenPriceRecording({ blockNumber, client, logger, mongooseModels }),
      buildRetryOptions({
        name: 'handleTokenPriceRecording',
        logger,
      }),
    );

    // logger.info(`handled block ${blockNumber}`);
  } catch (error) {
    logger.error(`error handling block ${blockNumber}: ${error}`);
  }
}
