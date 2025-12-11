import { gnosisChainArchiveClient as archiveClient, gnosisChainPublicClient as client } from '../public-client.ts';
import { MONGODB_DEBUG, MONGODB_URI, REDIS_URL, THE_GRAPH_API_KEY } from '../config/env.ts';
import {
  gCrcToken,
  gnosisPayTokens,
  isValidWeekId,
  payoutSafes,
  tokenBalanceSnapshotTokens,
  type WeekIdFormatType,
} from '@kpk/gnosis-pay-rewards-sdk';
import { createConnection, createModels, saveTokensToDatabase } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import { getLogger } from '../logger.ts';
import { BlockInfoProvider } from '../lib/block-info-provider.ts';
import { RedisCache } from '../lib/redis-cache.ts';
import { getGnosisTokenTransferLogs } from '../gp/getGnosisTokenTransferLogs.ts';
import { createLogHandler } from '../handleLogs.ts';
import { processGnosisTokenTransferLog } from '../process/token-transfer.ts';
import { processRewardTransactionLog } from '../process/reward-transaction.ts';
import type { TokenTransferLogType } from '../gp/getTokenTransferLogs.ts';
import { type Address } from 'viem';

/**
 * Process token transfer logs for a specific block range (x to y blocks) or for a week ID
 * This script only processes Gnosis token transfer logs and creates token balance snapshots.
 *
 * Usage:
 *   deno run -A src/scripts/process-block-range.ts <weekId>
 *   deno run -A src/scripts/process-block-range.ts <fromBlock> <toBlock>
 *
 * Examples:
 *   deno run -A src/scripts/process-block-range.ts 2024-03-01
 *   deno run -A src/scripts/process-block-range.ts 1000000 1000100
 */
async function main() {
  const args = Deno.args;

  if (args.length < 1 || args.length > 2) {
    console.error('Usage:');
    console.error('  deno run -A src/scripts/process-block-range.ts <weekId>');
    console.error('  deno run -A src/scripts/process-block-range.ts <fromBlock> <toBlock>');
    console.error('');
    console.error('Examples:');
    console.error('  deno run -A src/scripts/process-block-range.ts 2024-03-01');
    console.error('  deno run -A src/scripts/process-block-range.ts 1000000 1000100');
    Deno.exit(1);
  }

  let fromBlock!: number;
  let toBlock!: number;
  let weekId: WeekIdFormatType | undefined;

  // Determine if first argument is a week ID or block number
  if (args.length === 1) {
    // Single argument: treat as week ID
    const weekIdCandidate = args[0];
    if (!isValidWeekId(weekIdCandidate)) {
      console.error(`Invalid week ID: ${weekIdCandidate}`);
      console.error('Week ID must be in YYYY-MM-DD format and must be a Sunday (e.g., 2024-03-01)');
      Deno.exit(1);
    }
    weekId = weekIdCandidate;
    // fromBlock and toBlock will be set later from the week ID
  } else {
    // Two arguments: treat as block range
    const fromBlockCandidate = parseInt(args[0], 10);
    const toBlockCandidate = parseInt(args[1], 10);

    if (isNaN(fromBlockCandidate) || isNaN(toBlockCandidate)) {
      console.error('Invalid block numbers. Both fromBlock and toBlock must be valid integers.');
      Deno.exit(1);
    }

    if (fromBlockCandidate > toBlockCandidate) {
      console.error('fromBlock must be less than or equal to toBlock');
      Deno.exit(1);
    }

    if (fromBlockCandidate < 0 || toBlockCandidate < 0) {
      console.error('Block numbers must be positive');
      Deno.exit(1);
    }

    fromBlock = fromBlockCandidate;
    toBlock = toBlockCandidate;
  }

  try {
    const logger = await getLogger();

    const mongooseConnection = await createConnection(MONGODB_URI);
    mongooseConnection.set('debug', MONGODB_DEBUG);

    logger.info(`connected to mongodb at ${mongooseConnection.connection.host}`);

    const mongooseModels = createModels(mongooseConnection);
    const redisCache = new RedisCache({ logger, url: REDIS_URL });

    try {
      await redisCache.connect();
    } catch (error) {
      logger.error('Error connecting to cache', { error });
      throw error;
    }

    // Save the Gnosis Pay tokens and token balance snapshot tokens to the database
    await saveTokensToDatabase(mongooseModels.tokenModel, [...gnosisPayTokens, ...tokenBalanceSnapshotTokens]);

    const blockInfoProvider = new BlockInfoProvider(
      client,
      archiveClient,
      THE_GRAPH_API_KEY,
      mongooseModels.blockModel,
      logger,
      redisCache,
    );

    // If week ID is provided, get the block range for that week
    if (weekId) {
      logger.info(`Getting block range for week: ${weekId}`);
      const weekBlockRange = await blockInfoProvider.getWeekBlockRange(weekId);
      fromBlock = weekBlockRange.startBlock;
      toBlock = weekBlockRange.endBlock;
      logger.info(`Week ${weekId} block range: ${fromBlock} to ${toBlock}`);
    }
    // At this point, fromBlock and toBlock are guaranteed to be assigned:
    // - If weekId was provided, they were set from getWeekBlockRange
    // - If weekId was not provided, they were set from command line args

    logger.info(`Processing block range: ${fromBlock} to ${toBlock}`);

    // Track snapshot summary data (aggregated across all chunks)
    const snapshotSummary = {
      addressesProcessed: new Set<string>(),
      totalSnapshotsTaken: 0,
      snapshotsByAddress: new Map<string, number>(),
    };

    // Process in chunks of 1000 blocks
    const CHUNK_SIZE = 1000;
    const totalBlocks = toBlock - fromBlock + 1;
    const totalChunks = Math.ceil(totalBlocks / CHUNK_SIZE);

    logger.info(`Processing ${totalBlocks} blocks in ${totalChunks} chunks of ${CHUNK_SIZE} blocks`);

    const overallSummary = {
      totalLogs: 0,
      processedSuccessfully: 0,
      errors: 0,
      errorDetails: [] as Array<{
        transactionHash: string | null;
        blockNumber: bigint | null;
        eventName?: string;
        errorMessage: string;
      }>,
    };

    // Process each chunk
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const chunkFromBlock = fromBlock + chunkIndex * CHUNK_SIZE;
      const chunkToBlock = Math.min(chunkFromBlock + CHUNK_SIZE - 1, toBlock);

      logger.info(`Processing chunk ${chunkIndex + 1}/${totalChunks}: blocks ${chunkFromBlock} to ${chunkToBlock}`);

      // Fetch token transfer logs for this chunk, filtering by METRI_SAFE_ADDRESSES
      // We need to fetch transfers FROM Metri Safes and TO Metri Safes separately
      // because viem's getLogs requires separate queries for OR logic
      const [
        transfersFromMetriSafes,
        transfersToMetriSafes,
        rewardTransactionsFromMetriGcrc,
      ] = await Promise.all([
        getTokenTransferLogs({
          client: archiveClient,
          fromBlock: BigInt(chunkFromBlock),
          toBlock: BigInt(chunkToBlock),
          verbose: true,
          from: METRI_SAFE_ADDRESSES as Address[],
        }),
        getTokenTransferLogs({
          client: archiveClient,
          fromBlock: BigInt(chunkFromBlock),
          toBlock: BigInt(chunkToBlock),
          verbose: true,
          to: METRI_SAFE_ADDRESSES as Address[],
        }),
        // Fetch gCrcToken reward transactions from Metri payout safe to Metri safes
        getTokenTransferLogs({
          client: archiveClient,
          fromBlock: BigInt(chunkFromBlock),
          toBlock: BigInt(chunkToBlock),
          verbose: true,
          address: gCrcToken.address,
          from: [payoutSafes.metri],
          to: METRI_SAFE_ADDRESSES as Address[],
        }),
      ]);

      // Merge and deduplicate token transfer logs (same transaction hash + log index = same log)
      const logMap = new Map<string, typeof transfersFromMetriSafes[number]>();
      for (const log of transfersFromMetriSafes) {
        const key = `${log.transactionHash}-${log.logIndex}`;
        logMap.set(key, log);
      }
      for (const log of transfersToMetriSafes) {
        const key = `${log.transactionHash}-${log.logIndex}`;
        logMap.set(key, log);
      }
      const gnosisTokenTransferLogs = Array.from(logMap.values());

      // Merge and deduplicate reward transaction logs
      const rewardLogMap = new Map<string, typeof rewardTransactionsFromMetriGcrc[number]>();
      for (const log of rewardTransactionsFromMetriGcrc) {
        const key = `${log.transactionHash}-${log.logIndex}`;
        rewardLogMap.set(key, log);
      }
      const rewardTransactionLogs = Array.from(rewardLogMap.values());

      logger.info(
        `Found ${transfersFromMetriSafes.length} transfers FROM Metri Safes, ${transfersToMetriSafes.length} transfers TO Metri Safes, ${gnosisTokenTransferLogs.length} unique logs after deduplication in chunk ${
          chunkIndex + 1
        }`,
      );
      logger.info(
        `Found ${rewardTransactionsFromMetriGcrc.length} gCrcToken reward transactions FROM Metri payout safe, ${rewardTransactionLogs.length} unique reward transaction logs after deduplication in chunk ${
          chunkIndex + 1
        }`,
      );

      // Filter out logs that don't have valid args (these are likely not valid Transfer events)
      const validLogs = gnosisTokenTransferLogs.filter((log) => {
        return log.args && typeof log.args === 'object' && 'from' in log.args && 'to' in log.args;
      });

      if (validLogs.length < gnosisTokenTransferLogs.length) {
        const invalidCount = gnosisTokenTransferLogs.length - validLogs.length;
        logger.warn(`Filtered out ${invalidCount} invalid logs in chunk ${chunkIndex + 1} (missing or invalid args)`);
      }

      logger.info(`Found ${validLogs.length} valid token transfer logs in chunk ${chunkIndex + 1}`);

      // Create custom handler with result callback to collect snapshot data
      const handleGnosisTokenTransferLogsWithSummary = createLogHandler(processGnosisTokenTransferLog, (result) => {
        if (result.data) {
          const { processedAddresses } = result.data;

          // Track processed addresses
          processedAddresses.forEach((addr) => {
            snapshotSummary.addressesProcessed.add(addr);

            // Calculate snapshots for this address (number of tokens)
            const snapshotsForAddress = tokenBalanceSnapshotTokens.length;
            snapshotSummary.totalSnapshotsTaken += snapshotsForAddress;

            const currentCount = snapshotSummary.snapshotsByAddress.get(addr) || 0;
            snapshotSummary.snapshotsByAddress.set(addr, currentCount + snapshotsForAddress);
          });
        }
      });

      // Process token transfer logs for this chunk
      const chunkSummary = await handleGnosisTokenTransferLogsWithSummary({
        client: archiveClient,
        mongooseModels,
        logs: validLogs,
        logger,
        blockInfoProvider,
        redisCache,
      });

      // Filter reward transaction logs to only include valid ones
      const validRewardLogs = rewardTransactionLogs.filter((log) => {
        return log.args && typeof log.args === 'object' && 'from' in log.args && 'to' in log.args;
      });

      if (validRewardLogs.length < rewardTransactionLogs.length) {
        const invalidCount = rewardTransactionLogs.length - validRewardLogs.length;
        logger.warn(
          `Filtered out ${invalidCount} invalid reward transaction logs in chunk ${
            chunkIndex + 1
          } (missing or invalid args)`,
        );
      }

      logger.info(`Found ${validRewardLogs.length} valid reward transaction logs in chunk ${chunkIndex + 1}`);

      // Process reward transaction logs for this chunk
      // Use createLogHandler to get summary statistics
      // Both token transfer logs and reward transaction logs are ERC20 Transfer events,
      // so they're compatible. We cast to satisfy TypeScript.
      const handleRewardTransactionLogs = createLogHandler(processRewardTransactionLog);
      const rewardChunkSummary = await handleRewardTransactionLogs({
        client: archiveClient,
        mongooseModels,
        logs: validRewardLogs as TokenTransferLogType[],
        logger,
        blockInfoProvider,
        redisCache,
      });

      // Aggregate summary data for token transfers
      overallSummary.totalLogs += chunkSummary.totalLogs;
      overallSummary.processedSuccessfully += chunkSummary.processedSuccessfully;
      overallSummary.errors += chunkSummary.errors;
      if (chunkSummary.errorDetails) {
        overallSummary.errorDetails.push(...chunkSummary.errorDetails);
      }

      // Aggregate summary data for reward transactions
      overallSummary.totalLogs += rewardChunkSummary.totalLogs;
      overallSummary.processedSuccessfully += rewardChunkSummary.processedSuccessfully;
      overallSummary.errors += rewardChunkSummary.errors;
      if (rewardChunkSummary.errorDetails) {
        overallSummary.errorDetails.push(...rewardChunkSummary.errorDetails);
      }

      logger.info(
        `Completed chunk ${
          chunkIndex + 1
        }/${totalChunks}: ${chunkSummary.processedSuccessfully}/${chunkSummary.totalLogs} token transfers processed successfully, ${rewardChunkSummary.processedSuccessfully}/${rewardChunkSummary.totalLogs} reward transactions processed successfully`,
      );
    }

    const summary = overallSummary;

    // Output detailed summary
    console.log('\n' + '='.repeat(80));
    console.log('TOKEN TRANSFER AND REWARD TRANSACTION PROCESSING SUMMARY');
    console.log('='.repeat(80));
    if (weekId) {
      console.log(`Week ID: ${weekId}`);
    }
    console.log(`Block Range: ${fromBlock} to ${toBlock}`);
    console.log(`Total Logs Processed: ${summary.totalLogs}`);
    console.log(`Successfully Processed: ${summary.processedSuccessfully}`);
    console.log(`Errors: ${summary.errors}`);
    console.log('\n' + '-'.repeat(80));
    console.log('SNAPSHOTS SUMMARY');
    console.log('-'.repeat(80));
    console.log(`Total Addresses Processed: ${snapshotSummary.addressesProcessed.size}`);
    console.log(`Total Snapshots Taken: ${snapshotSummary.totalSnapshotsTaken}`);
    console.log(
      `  (${snapshotSummary.addressesProcessed.size} addresses × ${tokenBalanceSnapshotTokens.length} tokens)`,
    );

    if (snapshotSummary.addressesProcessed.size > 0) {
      console.log('\n' + '-'.repeat(80));
      console.log('ADDRESSES WITH SNAPSHOTS:');
      console.log('-'.repeat(80));

      const addressesArray = Array.from(snapshotSummary.addressesProcessed).sort();
      addressesArray.forEach((address) => {
        const snapshotCount = snapshotSummary.snapshotsByAddress.get(address) || 0;
        console.log(`  ${address}: ${snapshotCount} snapshots`);
      });
    }

    if (summary.errors > 0 && summary.errorDetails) {
      console.log('\n' + '-'.repeat(80));
      console.log('ERRORS:');
      console.log('-'.repeat(80));
      summary.errorDetails.forEach((error) => {
        console.log(`  Block ${error.blockNumber}: ${error.errorMessage}`);
        if (error.transactionHash) {
          console.log(`    Transaction: ${error.transactionHash}`);
        }
      });
    }

    console.log('\n' + '='.repeat(80) + '\n');

    logger.info(`Successfully processed token transfers`, {
      weekId,
      fromBlock,
      toBlock,
      totalLogs: summary.totalLogs,
      processedSuccessfully: summary.processedSuccessfully,
      errors: summary.errors,
      totalAddresses: snapshotSummary.addressesProcessed.size,
      totalSnapshots: snapshotSummary.totalSnapshotsTaken,
    });

    // Cleanup
    await mongooseConnection.disconnect();
    await redisCache.disconnect();

    logger.info('Script completed successfully');
    Deno.exit(0);
  } catch (e) {
    console.error('Error processing custom block range:', e);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
