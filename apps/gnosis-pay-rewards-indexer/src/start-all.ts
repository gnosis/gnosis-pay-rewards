import { ENABLE_INDEXING, MONGODB_DEBUG, MONGODB_URI, RESUME_INDEXING } from './config/env.ts';
import { gnosisPayTokens, tokenBalanceSnapshotTokens } from '@kpk/gnosis-pay-rewards-sdk';
import { createConnection, createModels, saveTokensToDatabase } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import { getLogger } from './logger.ts';
import {
  createIndexerCheckpointModel,
  IndexerCheckpointModelType,
  loadIndexerCheckpoint,
} from './lib/indexer-checkpoint.ts';
import type { Logger } from 'winston';
import type { Mongoose } from 'mongoose';
import { NOV_2025_INDEXER_ID, NOV_2025_START_BLOCK, OLD_INDEXER_ID, OLD_INDEXER_START_BLOCK } from './constants.ts';

type SpawnProcessOptions = {
  entryFile: string;
  processName: string;
  logger: Logger;
  args?: string[];
  metadata?: Record<string, unknown>;
  useAllowAll?: boolean; // If true, use -A, otherwise use individual flags from args
};

/**
 * Spawn a child process with output handling and lifecycle management
 */
function spawnProcess(options: SpawnProcessOptions) {
  const { entryFile, processName, logger, args = [], metadata = {}, useAllowAll = true } = options;
  const currentFile = new URL(import.meta.url);
  const entryPath = new URL(entryFile, currentFile).pathname;

  // Build command args: script path comes before script arguments
  // Format: deno run [flags] <script> [script-args]
  // When useAllowAll is true: deno run -A <script> [script-args]
  // When useAllowAll is false: deno run [permission-flags] <script> [script-args]
  const commandArgs = useAllowAll ? ['run', '-A', entryPath, ...args] : ['run', ...args, entryPath];

  const command = new Deno.Command(Deno.execPath(), {
    args: commandArgs,
    stdout: 'piped',
    stderr: 'piped',
  });

  const process = command.spawn();
  logger.info(`Spawned ${processName} process`, { pid: process.pid, ...metadata });

  // Handle process output
  const stdout = process.stdout.getReader();
  const stderr = process.stderr.getReader();

  const readOutput = async (reader: ReadableStreamDefaultReader<Uint8Array>, type: 'stdout' | 'stderr') => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = new TextDecoder().decode(value);
        const prefix = `[${processName} ${process.pid}]`;
        if (type === 'stderr') {
          console.error(`${prefix} ${text.trim()}`);
        } else {
          console.log(`${prefix} ${text.trim()}`);
        }
      }
    } catch (error) {
      console.error(`Error reading ${type} from ${processName} process`, { error, ...metadata });
    }
  };

  // Read output in background
  readOutput(stdout, 'stdout').catch(() => {});
  readOutput(stderr, 'stderr').catch(() => {});

  // Handle process exit
  process.status.then((status) => {
    if (status.code !== 0) {
      console.error(`${processName} process exited with error`, {
        code: status.code,
        signal: status.signal,
        ...metadata,
      });
    } else {
      logger.info(`${processName} process exited`, { code: status.code, ...metadata });
    }
  });

  return process;
}

/**
 * Spawn a child process for the HTTP server
 */
function spawnHttpServerProcess(logger: Logger) {
  return spawnProcess({
    entryFile: 'start-http-server.ts',
    processName: 'http-server',
    logger,
  });
}

/**
 * Spawn a child process for an indexer
 */
function spawnIndexerProcess(indexerId: string, startBlock: number, logger: Logger) {
  return spawnProcess({
    entryFile: 'start-indexer.ts',
    processName: 'indexer',
    logger,
    useAllowAll: true,
    args: [indexerId, startBlock.toString()],
    metadata: { indexerId, startBlock },
  });
}

/**
 * Initialize database connection and models
 */
async function initializeDatabase(logger: Logger) {
  const mongooseConnection = await createConnection(MONGODB_URI);
  mongooseConnection.set('debug', MONGODB_DEBUG);

  logger.info(`connected to mongodb at ${mongooseConnection.connection.host}`);

  const mongooseModels = createModels(mongooseConnection);
  const indexerCheckpointModel = createIndexerCheckpointModel(mongooseConnection);

  // Save the Gnosis Pay tokens and token balance snapshot tokens to the database
  await saveTokensToDatabase(mongooseModels.tokenModel, [...gnosisPayTokens, ...tokenBalanceSnapshotTokens]);

  return { mongooseConnection, mongooseModels, indexerCheckpointModel };
}

/**
 * Load checkpoint for an indexer if resuming is enabled
 */
async function loadIndexerStartBlock(
  indexerCheckpointModel: IndexerCheckpointModelType,
  indexerId: string,
  defaultStartBlock: number,
  logger: Logger,
): Promise<number> {
  if (RESUME_INDEXING !== true) {
    return defaultStartBlock;
  }

  const checkpoint = await loadIndexerCheckpoint(indexerCheckpointModel, indexerId);
  if (checkpoint !== null) {
    const startBlock = checkpoint + 1;
    logger.info(`Will resume indexer ${indexerId} from checkpoint block ${startBlock}`);
    return startBlock;
  }

  return defaultStartBlock;
}

/**
 * Setup graceful shutdown handlers
 */
function setupShutdownHandlers(processes: Array<{ kill: () => void }>, mongooseConnection: Mongoose, logger: Logger) {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down processes...`);

    try {
      for (const process of processes) {
        process.kill();
      }
      logger.info('All child processes terminated');
    } catch (error) {
      logger.error('Error terminating processes', { error });
    }

    await mongooseConnection.disconnect();
    Deno.exit(0);
  };

  Deno.addSignalListener('SIGINT', () => shutdown('SIGINT'));
  Deno.addSignalListener('SIGTERM', () => shutdown('SIGTERM'));
}

async function main() {
  try {
    const logger = await getLogger();
    logger.info('Starting main orchestrator process');

    // Spawn HTTP server process
    logger.info('Spawning HTTP server process...');
    const httpServerProcess = spawnHttpServerProcess(logger);

    if (ENABLE_INDEXING === false) {
      logger.info('Indexing is disabled. Set ENABLE_INDEXING=true to enable indexing');
      // Keep the HTTP server running
      await httpServerProcess.status;
      return;
    }

    // Spawn indexer processes
    logger.info('Spawning indexer processes...');

    // Initialize database
    const { mongooseConnection, indexerCheckpointModel } = await initializeDatabase(logger);

    // Determine start blocks for each indexer
    const oldIndexerStartBlock = await loadIndexerStartBlock(
      indexerCheckpointModel,
      OLD_INDEXER_ID,
      OLD_INDEXER_START_BLOCK,
      logger,
    );

    const nov2025IndexerStartBlock = await loadIndexerStartBlock(
      indexerCheckpointModel,
      NOV_2025_INDEXER_ID,
      NOV_2025_START_BLOCK,
      logger,
    );

    const indexerProcesses = [
      spawnIndexerProcess(OLD_INDEXER_ID, oldIndexerStartBlock, logger),
      spawnIndexerProcess(NOV_2025_INDEXER_ID, nov2025IndexerStartBlock, logger),
    ];

    logger.info('All processes spawned successfully', {
      httpServerPid: httpServerProcess.pid,
      indexerPids: indexerProcesses.map((p) => p.pid),
    });

    // Set up signal handlers for graceful shutdown
    setupShutdownHandlers([httpServerProcess, ...indexerProcesses], mongooseConnection, logger);

    // Wait for all processes (they run indefinitely)
    // If any process exits unexpectedly, log it but don't crash the orchestrator
    const allProcesses = [httpServerProcess, ...indexerProcesses];
    await Promise.allSettled(allProcesses.map((process) => process.status));

    logger.warn('One or more child processes exited');
  } catch (e) {
    console.error('Orchestrator error:', e);
    Deno.exit(1);
  }
}

main();
