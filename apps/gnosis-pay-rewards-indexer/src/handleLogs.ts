/* eslint-disable @typescript-eslint/no-explicit-any */
import type { WeekIdFormatType } from '@kpk/gnosis-pay-rewards-sdk';
import type { Logger } from 'winston';
import type { Log } from 'viem';

import { processRewardTransactionLog } from './process/reward-transaction.ts';
import { processRefundLog, processSpendLog } from './process/spend-log.ts';
import { processGnosisTokenTransferLog } from './process/token-transfer.ts';
import { processGnosisPayClaimOgNftLog } from './process/claim-og-nft.ts';
import type { TokenTransferLogType } from './gp/getTokenTransferLogs.ts';

export type LogHandlerSummary = {
  totalLogs: number;
  processedSuccessfully: number;
  errors: number;
  errorDetails?: Array<{
    transactionHash: string | null;
    blockNumber: bigint | null;
    eventName?: string;
    errorMessage: string;
  }>;
};

/**
 * Creates a wrapped handler function that automatically handles try/catch and error checking for an array of logs
 * @param handlerFunction - The process function to wrap (e.g., processSpendLog, processRefundLog)
 * @param onResult - Optional callback to process the result for each log (called only if no error)
 * @returns A function that accepts logs array and other params, and loops through logs with error handling, returning a summary
 */
export function createLogHandler<
  TLog extends Log,
  THandlerParams extends { log: TLog },
  THandlerResult extends { error: Error | null; data?: any },
>(
  handlerFunction: (params: THandlerParams) => Promise<THandlerResult>,
  onResult?: (result: THandlerResult & { error: null }) => void | Promise<void>,
) {
  return async (
    params: Omit<THandlerParams, 'log'> & {
      logger?: Logger;
      logs: TLog[];
    },
  ): Promise<LogHandlerSummary> => {
    const { logger, logs, ...handlerParams } = params;

    const summary: LogHandlerSummary = {
      totalLogs: logs.length,
      processedSuccessfully: 0,
      errors: 0,
      errorDetails: [],
    };

    for (const log of logs) {
      try {
        const result = await handlerFunction({
          ...handlerParams,
          log,
        } as unknown as THandlerParams);

        if (result.error) {
          throw result.error;
        }

        logger?.debug(`processed log ${log.transactionHash}`);
        summary.processedSuccessfully++;

        if (onResult) {
          await onResult(result as THandlerResult & { error: null });
        }
      } catch (e) {
        const error = e as Error;
        handleError({ logger, error, log });
        summary.errors++;
        summary.errorDetails?.push({
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          eventName: (log as any).eventName ?? undefined,
          errorMessage: error.message,
        });
      }
    }

    return summary;
  };
}

export const handleSpendLogs = createLogHandler(processSpendLog);

export const handleRefundLogs = createLogHandler(processRefundLog);

export const handleGnosisTokenTransferLogs = createLogHandler(
  processGnosisTokenTransferLog,
);

export const handleGnosisPayOgNftTransferLogs = createLogHandler(
  processGnosisPayClaimOgNftLog,
);

export async function handleGnosisPayRewardsDistributionLogs({
  mongooseModels,
  logger,
  logs,
  client,
  blockInfoProvider,
  redisCache,
}: Omit<Parameters<typeof processRewardTransactionLog>[0], 'log'> & {
  logs: TokenTransferLogType[];
  logger?: Logger;
}) {
  // Set of blocks to update
  const weekIdsSet = new Set<string>();
  const addressesPerWeek = new Map<
    string,
    {
      receivedRewardsCount: number;
      notReceivedRewardsCount: number;
    }
  >();

  const handleLogs = createLogHandler(
    processRewardTransactionLog,
    (result) => {
      if (result.data && result.data.week !== null) {
        const weekId = result.data.week;
        weekIdsSet.add(result.data.week);

        const weekData = addressesPerWeek.get(weekId) ?? {
          receivedRewardsCount: 0,
          notReceivedRewardsCount: 0,
        };

        weekData.receivedRewardsCount++;
        addressesPerWeek.set(weekId, weekData);
      }
    },
  );

  const summary = await handleLogs({
    logger,
    logs,
    mongooseModels,
    client,
    blockInfoProvider,
    redisCache,
  });

  logger?.debug(
    `processed ${summary.processedSuccessfully}/${summary.totalLogs} reward distribution logs`,
    {
      summary,
    },
  );

  // For each week id, update all the addresses that have not received a transaction to 0
  for (const week of Array.from(weekIdsSet) as WeekIdFormatType[]) {
    try {
      // Set each address that has not received a reward for the week to 0
      const query = {
        week,
        $and: [{ earnedReward: { $exists: false } }, { earnedReward: null }],
      };

      const queryResult = await mongooseModels.safeWeekRewardsSnapshotModel
        .updateMany(query, {
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
      handleError({
        logger,
        error: e as Error,
      });
    }
  }

  // Log the results
  for (
    const [week, { receivedRewardsCount, notReceivedRewardsCount }] of addressesPerWeek
  ) {
    logger?.debug(
      `week ${week} rewards distribution: ${receivedRewardsCount} received, ${notReceivedRewardsCount} not received`,
      {
        week,
        receivedRewardsCount,
        notReceivedRewardsCount,
      },
    );
  }
}

type HandleErrorParams = {
  logger?: Logger;
  error: unknown;
  log?: Log & { eventName?: string };
};

function handleError(
  params: HandleErrorParams,
) {
  const { logger, log } = params;
  const error = params.error as Error;
  if (error.cause === 'INVALID_SENDER_OR_RECEIVER_ADDRESS') {
    return;
  }

  logger?.log(
    error.cause === 'LOG_ALREADY_PROCESSED' ? 'verbose' : 'error',
    `Error processing (eventName: ${log?.eventName}, transactionHash: ${log?.transactionHash}, blockNumber: ${log?.blockNumber}) with error: ${error.message}`,
    {
      originalError: error.message,
      log: {
        ...log,
        blockNumber: log?.blockNumber ? Number(log.blockNumber) : undefined,
      },
    },
  );
}
