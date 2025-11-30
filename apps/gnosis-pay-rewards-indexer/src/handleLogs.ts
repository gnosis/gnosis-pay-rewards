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

  //TODO: implement bulk insert and rework concurrency
  const CONCURRENCY = 10;
  const results = [];
  
  for (let i = 0; i < logs.length; i += CONCURRENCY) {
    const batch = logs.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (log) => {
        try {
          const { data, error } = await processSpendLog({
            client,
            log,
            mongooseModels,
          });

          if (error) throw error;

          if (data !== null && socketIoServer) {
            socketIoServer.emit('newSpendTransaction', data.gnosisPayTransaction);
            socketIoServer.emit('newTransaction', data.gnosisPayTransaction);
            socketIoServer.emit('currentWeekMetricsSnapshotUpdated', data.weekMetricsSnapshot);
          }
          
          return data;
        } catch (e) {
          handleError(logger, e as Error, log as any);
          throw e;
        }
      })
    );
    results.push(...batchResults);
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
  const CONCURRENCY = 10;
  const results = [];
  
  for (let i = 0; i < logs.length; i += CONCURRENCY) {
    const batch = logs.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (log) => {
        try {
          const { data, error } = await processRefundLog({
            client,
            log,
            mongooseModels,
          });

          if (error) throw error;

          if (data !== null && socketIoServer) {
            socketIoServer.emit('newRefundTransaction', data.gnosisPayTransaction);
            socketIoServer.emit('newTransaction', data.gnosisPayTransaction);
            socketIoServer.emit('currentWeekMetricsSnapshotUpdated', data.weekMetricsSnapshot);
          }
          
          return data;
        } catch (e) {
          handleError(logger, e as Error, log as any);
          throw e;
        }
      })
    );
    results.push(...batchResults);
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
  const CONCURRENCY = 10;
  const results = [];
  
  for (let i = 0; i < logs.length; i += CONCURRENCY) {
    const batch = logs.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (log) => {
        try {
          const { error } = await processGnosisTokenTransferLog({
            client,
            log,
            mongooseModels,
          });

          if (error) throw error;
        } catch (e) {
          handleError(logger, e as Error, log as any);
          throw e;
        }
      })
    );
    results.push(...batchResults);
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
  const CONCURRENCY = 10;
  const results = [];
  
  for (let i = 0; i < logs.length; i += CONCURRENCY) {
    const batch = logs.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (log) => {
        try {
          const { error } = await processGnosisPayClaimOgNftLog({
            client,
            log,
            mongooseModels,
          });

          if (error) throw error;
        } catch (e) {
          handleError(logger, e as Error, log as any);
          throw e;
        }
      })
    );
    results.push(...batchResults);
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

  const CONCURRENCY = 10;
  const allResults = [];
  
  for (let i = 0; i < logs.length; i += CONCURRENCY) {
    const batch = logs.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (log) => {
        try {
          const { error, data } = await processGnosisPayRewardDistributionLog({
            log,
            mongooseModels,
            client,
          });

          if (error) throw error;
          return data;
        } catch (e) {
          handleError(logger, e as Error, log as any);
          throw e;
        }
      })
    );
    allResults.push(...batchResults);
  }

  for (const result of allResults) {
    if (result.status === 'fulfilled' && result.value.week !== null) {
      const weekId = result.value.week;
      weekIdsSet.add(result.value.week);

      const weekData = addressesPerWeek.get(weekId) ?? {
        receivedRewardsCount: 0,
        notReceivedRewardsCount: 0,
      };

      weekData.receivedRewardsCount++;
      addressesPerWeek.set(weekId, weekData);
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
    } catch (e) {}
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
