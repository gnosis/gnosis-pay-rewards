import { WeekIdFormatType } from '@karpatkey/gnosis-pay-rewards-sdk';
import { createMongooseLogger, LogLevel } from '@karpatkey/gnosis-pay-rewards-sdk/mongoose';
import { PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';

import { getGnosisPaySpendLogs } from './gp/getGnosisPaySpendLogs.js';
import { getGnosisPayRefundLogs } from './gp/getGnosisPayRefundLogs.js';
import { getGnosisTokenTransferLogs } from './gp/getGnosisTokenTransferLogs.js';
import { getGnosisPayRewardDistributionLogs } from './gp/getGnosisPayRewardDistributionLogs.js';
import { getGnosisPayClaimOgNftLogs } from './gp/getGnosisPayClaimOgNftLogs.js';

import { processGnosisPayRewardDistributionLog } from './process/processGnosisPayRewardDistributionLog.js';
import { processRefundLog, processSpendLog } from './process/processSpendLog.js';
import { processGnosisTokenTransferLog } from './process/processGnosisTokenTransferLog.js';
import { processGnosisPayClaimOgNftLog } from './process/processGnosisPayClaimOgNftLog.js';

import { buildSocketIoServer } from './server.js';

export async function handleBatchLogs({
  client,
  mongooseModels,
  socketIoServer,
  logger,
  logs,
}: WithLogger<{
  logs: (
    | Awaited<ReturnType<typeof getGnosisPaySpendLogs>>[0]
    | Awaited<ReturnType<typeof getGnosisPayRefundLogs>>[0]
  )[];
  client: PublicClient<Transport, typeof gnosis>;
  mongooseModels: Parameters<typeof processSpendLog>[0]['mongooseModels'];
  socketIoServer: ReturnType<typeof buildSocketIoServer>;
}>) {
  for (const log of logs) {
    try {
      if (log.eventName === 'Spend') {
        const { data, error } = await processSpendLog({
          client,
          log,
          mongooseModels,
        });

        if (error) throw error;

        if (data !== null) {
          socketIoServer.emit('newSpendTransaction', data.gnosisPayTransaction);
          socketIoServer.emit('newTransaction', data.gnosisPayTransaction);
          socketIoServer.emit('currentWeekMetricsSnapshotUpdated', data.weekMetricsSnapshot);
        }
      } else if (log.eventName === 'Transfer') {
        const { data, error } = await processRefundLog({
          client,
          log,
          mongooseModels,
        });

        if (error) throw error;

        if (data !== null) {
          socketIoServer.emit('newRefundTransaction', data.gnosisPayTransaction);
          socketIoServer.emit('newTransaction', data.gnosisPayTransaction);
          socketIoServer.emit('currentWeekMetricsSnapshotUpdated', data.weekMetricsSnapshot);
        }
      }
    } catch (e) {
      handleError(logger, e as Error, log as any);
    }
  }
}

export async function handleGnosisTokenTransferLogs({
  client,
  mongooseModels,
  logger,
  logs,
}: WithLogger<
  Omit<Parameters<typeof processGnosisTokenTransferLog>[0], 'log'> & {
    logs: LogsType<typeof getGnosisTokenTransferLogs>;
  }
>) {
  for (const log of logs) {
    try {
      const { error } = await processGnosisTokenTransferLog({
        client,
        log,
        mongooseModels,
      });

      if (error) throw error;
    } catch (e) {
      handleError(logger, e as Error, log as any);
    }
  }
}

export async function handleGnosisPayOgNftTransferLogs({
  mongooseModels,
  logger,
  client,
  logs,
}: WithLogger<
  Omit<Parameters<typeof processGnosisPayClaimOgNftLog>[0], 'log'> & {
    logs: LogsType<typeof getGnosisPayClaimOgNftLogs>;
  }
>) {
  for (const log of logs) {
    try {
      const { error } = await processGnosisPayClaimOgNftLog({
        client,
        log,
        mongooseModels,
      });

      if (error) throw error;
    } catch (e) {
      handleError(logger, e as Error, log as any);
    }
  }
}

export async function handleGnosisPayRewardsDistributionLogs({
  mongooseModels,
  logger,
  logs,
  client,
}: WithLogger<
  Omit<Parameters<typeof processGnosisPayRewardDistributionLog>[0], 'log'> & {
    logs: LogsType<typeof getGnosisPayRewardDistributionLogs>;
  }
>) {
  // Set of blocks to update
  const weekIdsSet = new Set<string>();
  const addressesPerWeek = new Map<
    string,
    {
      receivedRewardsCount: number;
      notReceivedRewardsCount: number;
    }
  >();

  for (const log of logs) {
    try {
      const { error, data } = await processGnosisPayRewardDistributionLog({
        log,
        mongooseModels,
        client,
      });

      if (error) throw error;

      if (data.week !== null) {
        const weekId = data.week;
        weekIdsSet.add(data.week);

        const weekData = addressesPerWeek.get(weekId) ?? {
          receivedRewardsCount: 0,
          notReceivedRewardsCount: 0,
        };

        weekData.receivedRewardsCount++;
        addressesPerWeek.set(weekId, weekData);
      }
    } catch (e) {
      handleError(logger, e as Error, log as any);
    }
  }

  // For each week id, update all the addresses that have not received a transaction to 0
  for (const week of Array.from(weekIdsSet) as WeekIdFormatType[]) {
    try {
      // Set each address that has not received a reward for the week to 0
      const query = {
        week,
        $and: [{ earnedReward: { $exists: false } }, { earnedReward: null }],
      };

      const queryResult = await mongooseModels.weekCashbackRewardModel.updateMany(query, {
        $set: {
          earnedReward: 0,
        },
      });

      const weekData = addressesPerWeek.get(week) ?? {
        receivedRewardsCount: 0,
        notReceivedRewardsCount: 0,
      };

      weekData.notReceivedRewardsCount += queryResult.modifiedCount;
      addressesPerWeek.set(week, weekData);
    } catch (e) {
      handleError(logger, e as Error, { blockNumber: 0n, eventName: 'none', transactionHash: 'none' });
    }
  }

  // Log the results
  for (const [week, { receivedRewardsCount, notReceivedRewardsCount }] of addressesPerWeek) {
    try {
      const message = `Week ${week} rewards distribution: ${receivedRewardsCount} received, ${notReceivedRewardsCount} not received`;
      console.log(message);
      await logger.logDebug({ message });
    } catch (e) {}
  }
}

function handleError(
  logger: ReturnType<typeof createMongooseLogger>,
  error: Error,
  logish: { eventName: string; transactionHash: string; blockNumber: bigint },
) {
  console.error(error);

  logger.log({
    level: error.cause === 'LOG_ALREADY_PROCESSED' ? LogLevel.WARN : LogLevel.ERROR,
    message: `Error processing ${logish.eventName} log (${logish.transactionHash}) at block ${logish.blockNumber} with error: ${error.message}`,
    metadata: {
      originalError: error.message,
      log: {
        ...logish,
        blockNumber: Number(logish.blockNumber),
      },
    },
  });
}

type WithLogger<T> = T & {
  logger: ReturnType<typeof createMongooseLogger>;
};

type LogsType<FunctionType extends (...args: any[]) => unknown> = Awaited<ReturnType<FunctionType>>;
