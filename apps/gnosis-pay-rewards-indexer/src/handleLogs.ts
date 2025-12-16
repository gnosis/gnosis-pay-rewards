/* eslint-disable @typescript-eslint/no-explicit-any */
import { WeekIdFormatType } from '@karpatkey/gnosis-pay-rewards-sdk';
import { PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';
import { Logger } from 'winston';

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
import { withRetry } from './gp/commons.js';

/**
 * Safely stringify an object that may contain bigint values
 */
function safeStringify(obj: any): string {
  return JSON.stringify(obj, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

export async function handleSpendLogs({
  logs,
  client,
  mongooseModels,
  socketIoServer,
  logger,
}: WithLogger<{
  logs: Awaited<ReturnType<typeof getGnosisPaySpendLogs>>;
  client: PublicClient<Transport, typeof gnosis>;
  mongooseModels: Parameters<typeof processSpendLog>[0]['mongooseModels'];
  socketIoServer?: ReturnType<typeof buildSocketIoServer>;
}>) {
  for (const log of logs) {
    try {
      const { data, error } = await withRetry(
        () =>
          processSpendLog({
            client,
            log,
            mongooseModels,
          }),
        {
          retries: 10,
          name: `processSpendLog(${log.transactionHash})`,
          verbose: true,
          logger,
        },
      );

      if (error) throw error;

      if (data !== null && socketIoServer) {
        socketIoServer.emit('newSpendTransaction', data.gnosisPayTransaction);
        socketIoServer.emit('newTransaction', data.gnosisPayTransaction);
        socketIoServer.emit('currentWeekMetricsSnapshotUpdated', data.weekMetricsSnapshot);
      }
    } catch (e) {
      handleError(logger, e as Error, log as any);
    }
  }
}

export async function handleRefundLogs({
  client,
  mongooseModels,
  socketIoServer,
  logger,
  logs,
}: WithLogger<{
  logs: Awaited<ReturnType<typeof getGnosisPayRefundLogs>>;
  client: PublicClient<Transport, typeof gnosis>;
  mongooseModels: Parameters<typeof processSpendLog>[0]['mongooseModels'];
  socketIoServer?: ReturnType<typeof buildSocketIoServer>;
}>) {
  for (const log of logs) {
    if(log.transactionHash === '0x0690a22551ad515fa741124ed83696d931e4de2e7de68eb051823cbbe5edb5d9' || log.transactionHash === '0xbd61ecaf54946bd8ec3a492fdbf89d0d3cc46228b15a9181c37c74f568794b6d') {
      logger.info(`DEBUG: Handling refund log: ${log.transactionHash} ${safeStringify(log)}`);
    }
    try {
      const { data, error } = await withRetry(
        () =>
          processRefundLog({
            client,
            log,
            mongooseModels,
          }),
        {
          retries: 10,
          name: `processRefundLog(${log.transactionHash})`,
          verbose: true,
          logger,
        },
      );

      if (error) throw error;

      if (data !== null && socketIoServer) {
        socketIoServer.emit('newRefundTransaction', data.gnosisPayTransaction);
        socketIoServer.emit('newTransaction', data.gnosisPayTransaction);
        socketIoServer.emit('currentWeekMetricsSnapshotUpdated', data.weekMetricsSnapshot);
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
      const { error } = await withRetry(
        () =>
          processGnosisTokenTransferLog({
            client,
            log,
            mongooseModels,
          }),
        {
          retries: 10,
          name: `processGnosisTokenTransferLog(${log.transactionHash})`,
          verbose: true,
          logger,
        },
      );

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
      const { error } = await withRetry(
        () =>
          processGnosisPayClaimOgNftLog({
            client,
            log,
            mongooseModels,
          }),
        {
          retries: 10,
          name: `processGnosisPayClaimOgNftLog(${log.transactionHash})`,
          verbose: true,
          logger,
        },
      );

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
      const { error, data } = await withRetry(
        () =>
          processGnosisPayRewardDistributionLog({
            log,
            mongooseModels,
            client,
          }),
        {
          retries: 10,
          name: `processGnosisPayRewardDistributionLog(${log.transactionHash})`,
          verbose: true,
          logger,
        },
      );

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
      logger.debug(
        `week ${week} rewards distribution: ${receivedRewardsCount} received, ${notReceivedRewardsCount} not received`,
        {
          week,
          receivedRewardsCount,
          notReceivedRewardsCount,
        },
      );
    } catch (e) { }
  }
}

function handleError(
  logger: Logger,
  error: Error,
  logish: { eventName: string; transactionHash: string; blockNumber: bigint },
) {
  if (error.cause === 'INVALID_SENDER_OR_RECEIVER_ADDRESS') {
    return;
  }

  if (error.cause === 'LOG_ALREADY_PROCESSED') {
    return;
  }

  if(error.cause === 'NOT_GNOSIS_PAY_SAFE_ADDRESS') {
    return;
  }

  logger.log(
    error.cause === 'LOG_ALREADY_PROCESSED' ? 'warn' : 'error',
    `Error processing ${logish.eventName} log (${logish.transactionHash}) at block ${logish.blockNumber} with error: ${error.message}`,
    {
      originalError: error.message,
      log: {
        ...logish,
        blockNumber: Number(logish.blockNumber),
      },
    },
  );
}

type WithLogger<T> = T & {
  logger: Logger;
};

type LogsType<FunctionType extends (...args: any[]) => unknown> = Awaited<ReturnType<FunctionType>>;