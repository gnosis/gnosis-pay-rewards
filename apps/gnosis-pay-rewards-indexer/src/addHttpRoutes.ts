import {
  GnosisPayTransactionFieldsType_Unpopulated,
  toWeekId,
  IndexerStateAtomType,
  WeekIdFormatType,
  GnosisTokenBalanceSnapshotDocumentType,
  isValidWeekId,
} from '@karpatkey/gnosis-pay-rewards-sdk';
import {
  createWeekCashbackRewardDocumentId,
  createWeekRewardsSnapshotDocument,
  createGnosisPayRewardDistributionModel,
  GnosisPayRewardDistributionDocumentFieldsType,
  createGnosisTokenBalanceSnapshotModel,
  createGnosisPaySafeAddressDocument,
  createWeekMetricsSnapshotModel,
  createWeekCashbackRewardModel,
  createGnosisPayTransactionModel,
  createGnosisPaySafeAddressModel,
  GnosisPaySafeAddressDocumentFieldsType_Unpopulated,
} from '@karpatkey/gnosis-pay-rewards-sdk/mongoose';
import { Express, Response } from 'express';

import { Address, isAddress, PublicClient, Transport, stringify } from 'viem';
import { gnosis } from 'viem/chains';
import { Logger } from 'winston';
import { z, ZodError } from 'zod';
// Core GP
import { takeGnosisTokenBalanceSnapshot } from './process/processGnosisTokenTransferLog.js';
import { getGnosisPaySafeOwners } from './gp/getGnosisPaySafeOwners.js';
import { isGnosisPaySafeAddress } from './gp/isGnosisPaySafeAddress.js';
import { hasGnosisPayOgNft } from './gp/hasGnosisPayOgNft.js';
import { dayjsUtc as dayjs } from './dayjs-utc.js';

export function addHttpRoutes({
  expressApp,
  mongooseModels,
  getIndexerState,
  client,
  logger,
}: {
  expressApp: Express;
  mongooseModels: {
    gnosisTokenBalanceSnapshotModel: ReturnType<typeof createGnosisTokenBalanceSnapshotModel>;
    gnosisPaySafeAddressModel: ReturnType<typeof createGnosisPaySafeAddressModel>;
    gnosisPayTransactionModel: ReturnType<typeof createGnosisPayTransactionModel>;
    weekCashbackRewardModel: ReturnType<typeof createWeekCashbackRewardModel>;
    gnosisPayRewardDistributionModel: ReturnType<typeof createGnosisPayRewardDistributionModel>;
    weekMetricsSnapshotModel: ReturnType<typeof createWeekMetricsSnapshotModel>;
  };
  logger: Logger;
  client: PublicClient<Transport, typeof gnosis>;
  getIndexerState: () => IndexerStateAtomType;
}) {
  const {
    gnosisTokenBalanceSnapshotModel,
    gnosisPaySafeAddressModel,
    gnosisPayTransactionModel,
    weekCashbackRewardModel,
    gnosisPayRewardDistributionModel,
    weekMetricsSnapshotModel,
  } = mongooseModels;

  expressApp.get<'/'>('/', (_, res) => {
    return res.send({
      status: 'ok',
      statusCode: 200,
    });
  });

  expressApp.get<'/status'>('/status', (_, res) => {
    const state = getIndexerState();
    const indexerState = JSON.parse(stringify(state)); // vime handles most of the types

    return res.send({
      data: indexerState,
      status: 'ok',
      statusCode: 200,
    });
  });

  expressApp.get<'/health'>('/health', (_, res) => {
    return res.send({
      status: 'ok',
      statusCode: 200,
    });
  });

  expressApp.get<'/week-snapshots/:weekId'>('/week-snapshots/:weekId', async (req, res) => {
    try {
      const weekId = weekIdSchema.parse(req.params.weekId) as WeekIdFormatType;
      const _query = { week: weekId };
      const weekSafeSnapshot = await weekCashbackRewardModel
        .find(_query)
        .populate<{ transactions: GnosisPayTransactionFieldsType_Unpopulated[] }>('transactions', {
          amountUsd: 1,
          amountToken: 1,
          amount: 1,
          transactionHash: 1,
          gnoBalance: 1,
          type: 1,
        })
        .populate<{ gnoBalanceSnapshots: GnosisTokenBalanceSnapshotDocumentType[] }>('gnoBalanceSnapshots', {
          blockNumber: 1,
          blockTimestamp: 1,
          balance: 1,
        })
        .populate<{ safe: { isOg: boolean; _id: Address } }>('safe', { isOg: 1 })
        .lean();

      return res.json({
        data: weekSafeSnapshot,
        status: 'ok',
        statusCode: 200,
        _query,
      });
    } catch (error) {
      return returnServerError({ response: res, error, logger });
    }
  });

  expressApp.get<'/weeks'>('/weeks', async (_, res) => {
    try {
      const weeksArray = await weekMetricsSnapshotModel.find({}, { date: 1 }).lean();

      const weeksArrayWithIds = weeksArray.map((week) => ({
        id: week.date.toString(),
        weekId: week.date.toString(),
      }));

      return res.json({
        data: weeksArrayWithIds,
        status: 'ok',
        statusCode: 200,
      });
    } catch (error) {
      return returnServerError({ response: res, error, logger });
    }
  });

  expressApp.get<'/cashbacks/:safeAddress'>('/cashbacks/:safeAddress', async (req, res) => {
    try {
      const safeAddress = addressSchema.parse(req.params.safeAddress).toLowerCase() as Address;
      const week = toWeekId(dayjs.utc().unix());
      const weekRewardSnapshot = await getWeekRewardSnapshotWithFallback({
        weekCashbackRewardModel,
        safeAddress,
        week,
        client,
        gnosisPaySafeAddressModel,
        gnosisTokenBalanceSnapshotModel,
      });

      // Final data to return to the client
      const weekCashbackRewardJson = weekRewardSnapshot?.toJSON();

      return res.json({
        data: weekCashbackRewardJson,
        status: 'ok',
        statusCode: 200,
        _query: {
          address: safeAddress,
        },
      });
    } catch (error) {
      return returnServerError({ response: res, error, logger });
    }
  });

  expressApp.get<'/cashbacks/:safeAddress/:week'>('/cashbacks/:safeAddress/:week', async (req, res) => {
    try {
      const safeAddress = addressSchema.parse(req.params.safeAddress);
      const week = req.params.week as ReturnType<typeof toWeekId>;
      const documentId = createWeekCashbackRewardDocumentId(week, safeAddress);

      const weekCashbackRewardSnapshot = await weekCashbackRewardModel
        .findById(documentId)
        .populate<{ transactions: GnosisPayTransactionFieldsType_Unpopulated[] }>('transactions')
        .populate<{ safe: GnosisPaySafeAddressDocumentFieldsType_Unpopulated }>('safe', {
          isOg: 1,
          address: 1,
        })
        .lean();

      if (weekCashbackRewardSnapshot === null) {
        return res.status(404).json({
          error: 'No cashbacks found for this address  and week',
          _query: {
            id: documentId,
            address: safeAddress,
            week,
          },
          status: 'error',
          statusCode: 404,
        });
      }

      return res.json({
        data: weekCashbackRewardSnapshot,
        status: 'ok',
        _query: {
          id: documentId,
          address: safeAddress,
          week,
        },
        statusCode: 200,
      });
    } catch (error) {
      return returnServerError({ response: res, error, logger });
    }
  });

  expressApp.get<'/summary/:safeAddress'>('/summary/:safeAddress', async (req, res) => {
    try {
      const safeAddress = addressSchema.parse(req.params.safeAddress).toLowerCase() as Address;
      const week = toWeekId(dayjs.utc().unix());
      // Try to find the week reward document
      const weekRewardSnapshotDocument = await getWeekRewardSnapshotWithFallback({
        weekCashbackRewardModel,
        safeAddress,
        week,
        client,
        gnosisPaySafeAddressModel,
        gnosisTokenBalanceSnapshotModel,
      });

      if (weekRewardSnapshotDocument === null) {
        return res.status(404).json({
          error: 'No cashbacks found for this address  and week',
          _query: {
            address: safeAddress,
            week,
          },
        });
      }

      const distributionDocuments = await getSafeAddressDistributions(gnosisPayRewardDistributionModel, safeAddress);
      const earnedRewards = distributionDocuments.reduce((acc, dist) => dist.amount + acc, 0);

      const weeklyRewardSnapshotDocuments = await weekCashbackRewardModel
        .find(
          {
            safe: safeAddress,
          },
          { estimatedReward: 1 }
        )
        .sort({ week: -1 })
        .lean();

      const estimatedRewards = weeklyRewardSnapshotDocuments.reduce(
        (acc, { estimatedReward }) => estimatedReward + acc,
        0
      );
      // pending rewards are the rewards that are pending to be claimed
      const pendingRewards = estimatedRewards - earnedRewards;
      // get the safe info from the week reward snapshot document
      const { safe, maxGnoBalance, minGnoBalance } = weekRewardSnapshotDocument.toJSON();

      const summary = {
        week,
        safe,
        maxGnoBalance,
        minGnoBalance,
        pendingRewards,
        earnedRewards,
      };

      return res.json({
        data: summary,
        status: 'ok',
        statusCode: 200,
        _query: {
          address: safeAddress,
        },
      });
    } catch (error) {
      return returnServerError({ response: res, error, logger });
    }
  });

  expressApp.get<'/distributions/:safeAddress'>('/distributions/:safeAddress', async (req, res) => {
    try {
      const safeAddress = addressSchema.parse(req.params.safeAddress).toLowerCase() as Address;
      const transactions = await getSafeAddressDistributions(gnosisPayRewardDistributionModel, safeAddress);
      const totalRewards = transactions.reduce((acc, dist) => dist.amount + acc, 0);

      return res.json({
        data: {
          safe: safeAddress,
          totalRewards,
          transactions,
        },
        status: 'ok',
        statusCode: 200,
        _query: {
          safe: safeAddress,
        },
      });
    } catch (error) {
      return returnServerError({ response: res, error, logger });
    }
  });

  expressApp.get<'/transactions/:safeAddress'>('/transactions/:safeAddress', async (req, res) => {
    try {
      const safeAddress = addressSchema.parse(req.params.safeAddress);
      const transactions = await gnosisPayTransactionModel
        .find({
          safeAddress: new RegExp(safeAddress, 'i'),
        })
        .populate('amountToken', {
          symbol: 1,
          decimals: 1,
          name: 1,
        })
        .sort({ blockTimestamp: -1 })
        .lean();

      return res.json({
        data: transactions,
        status: 'ok',
        statusCode: 200,
      });
    } catch (error) {
      return returnServerError({ response: res, error, logger });
    }
  });

  expressApp.get<'/gnosis-balance-snapshots/:safeAddress'>(
    '/gnosis-balance-snapshots/:safeAddress',
    async (req, res) => {
      try {
        const safeAddress = addressSchema.parse(req.params.safeAddress);
        const snapshots = await getGnosisBalanceSnapshots(gnosisTokenBalanceSnapshotModel, safeAddress);

        return res.json({
          data: snapshots,
          status: 'ok',
          statusCode: 200,
        });
      } catch (error) {
        return returnServerError({ response: res, error, logger });
      }
    }
  );

  // Handle all other routes
  expressApp.all('*', (req, res) => {
    return res.status(404).json({
      error: 'Not found',
      status: 'error',
      statusCode: 404,
    });
  });

  return expressApp;
}

class CustomError extends Error {}

/**
 * @param res Express response object
 * @param error Error object
 * @returns Express response object
 */
function returnServerError({ response, error, logger }: { response: Response; error: unknown; logger: Logger }) {
  logger.error('http server error', { error });

  const responseBody = {
    error: 'Internal server error',
    status: 'error',
    statusCode: 500,
    errorStack: error instanceof Error ? error.stack : undefined,
  };

  if (error instanceof ZodError || error instanceof CustomError) {
    return response.status(400).json({
      ...responseBody,
      error: error.message,
      statusCode: 400,
    });
  }

  return response.status(500).json({
    ...responseBody,
  });
}

const addressSchema = z.string().refine(isAddress, {
  message: 'Invalid EVM address',
});

const weekIdSchema = z
  .string()
  .refine((value: string) => isValidWeekId(value), {
    message: 'Invalid week date format',
  })
  .refine(
    (value: string) => {
      const isSunday = dayjs(value).day() === 0;
      return isSunday;
    },
    {
      message: 'Week date must be a Sunday',
    }
  );

async function getWeekRewardSnapshotWithFallback({
  safeAddress,
  week,
  client,
  gnosisPaySafeAddressModel,
  weekCashbackRewardModel,
  gnosisTokenBalanceSnapshotModel,
}: {
  safeAddress: Address;
  week: WeekIdFormatType;
  client: PublicClient<Transport, typeof gnosis>;
  gnosisPaySafeAddressModel: ReturnType<typeof createGnosisPaySafeAddressModel>;
  weekCashbackRewardModel: ReturnType<typeof createWeekCashbackRewardModel>;
  gnosisTokenBalanceSnapshotModel: ReturnType<typeof createGnosisTokenBalanceSnapshotModel>;
}) {
  const documentId = createWeekCashbackRewardDocumentId(week, safeAddress);

  const getDocument = async () =>
    weekCashbackRewardModel
      .findById(documentId)
      .populate<{ transactions: GnosisPayTransactionFieldsType_Unpopulated[] }>('transactions')
      .populate<{ gnoBalanceSnapshots: GnosisTokenBalanceSnapshotDocumentType[] }>('gnoBalanceSnapshots', {
        blockNumber: 1,
        blockTimestamp: 1,
        balance: 1,
        weekId: 1,
      })
      .populate<{ safe: GnosisPaySafeAddressDocumentFieldsType_Unpopulated }>('safe', {
        isOg: 1,
        address: 1,
      });

  // Take a snapshot of the GNO balance
  const takeGnoSnapshot = () =>
    takeGnosisTokenBalanceSnapshot({
      gnosisTokenBalanceSnapshotModel,
      weekCashbackRewardModel,
      gnosisPaySafeAddressModel,
      safeAddress,
      client,
    });

  // Try to find the week reward document
  let weekRewardSnapshotDocument = await getDocument();

  // The document does not exist, meaning that the API request has to trigger the creation of the document
  if (weekRewardSnapshotDocument === null) {
    const { isGnosisPaySafe } = await isGnosisPaySafeAddress({
      address: safeAddress,
      client,
      gnosisPaySafeAddressModel,
    });

    if (isGnosisPaySafe === false) {
      throw new CustomError('Address is not a Gnosis Safe', {
        cause: 'NOT_GNOSIS_PAY_SAFE',
      });
    }

    const newWeekRewardSnapshotDocument = await createWeekRewardsSnapshotDocument(
      weekCashbackRewardModel,
      week,
      safeAddress
    );

    // Carry over the net usd volume from the previous week if the current week has no transactions
    if (newWeekRewardSnapshotDocument.transactions.length === 0) {
      const prevWeekId = toWeekId(dayjs(week).subtract(1, 'week').unix());
      const prevDocumentId = createWeekCashbackRewardDocumentId(prevWeekId, safeAddress);
      const previousWeekCashbackReward = await weekCashbackRewardModel.findById(prevDocumentId);

      if (previousWeekCashbackReward !== null && previousWeekCashbackReward.netUsdVolume < 0) {
        newWeekRewardSnapshotDocument.netUsdVolume = previousWeekCashbackReward.netUsdVolume;
        await newWeekRewardSnapshotDocument.save();
      }
    }

    // Take a snapshot of the GNO balance
    await takeGnoSnapshot();

    const { data: safeOwners, error } = await getGnosisPaySafeOwners({
      safeAddress,
      client,
    });

    // zero owners mean that this address is likely not a GP Safe
    if (error !== null || safeOwners.length === 0) {
      throw new CustomError('No owners found for this safe');
    }

    // Find the OG NFT status
    const isOg = (await hasGnosisPayOgNft(client, safeOwners)).some(Boolean);

    // Create a new GnosisPaySafeAddressDocument
    await createGnosisPaySafeAddressDocument(
      {
        safeAddress,
        owners: safeOwners,
        isOg,
      },
      gnosisPaySafeAddressModel
    );

    // Refresh the document
    weekRewardSnapshotDocument = await getDocument();
  }

  return weekRewardSnapshotDocument;
}

async function getSafeAddressDistributions(
  model: ReturnType<typeof createGnosisPayRewardDistributionModel>,
  safeAddress: Address
) {
  return model
    .find<GnosisPayRewardDistributionDocumentFieldsType>({
      safe: safeAddress.toLowerCase(),
    })
    .sort({ blockNumber: -1 });
}

async function getGnosisBalanceSnapshots(
  model: ReturnType<typeof createGnosisTokenBalanceSnapshotModel>,
  safeAddress: Address
) {
  return model.find({
    safe: safeAddress.toLowerCase(),
  });
}
