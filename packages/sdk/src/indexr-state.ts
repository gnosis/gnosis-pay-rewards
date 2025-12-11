import { z } from 'zod';

export const indexerStateZodSchema = z
  .object({
    id: z.string().describe('The id of the indexer'),
    startedAt: z.number().describe('The timestamp when the indexer started'),
    startBlock: z.coerce.number().describe('The block number when the indexer started'),
    fetchBlockSize: z.coerce.number().describe('The block size to use for the initialization'),
    latestBlock: z.coerce.number().describe('The latest block number'),
    distanceToLatestBlock: z.coerce.number().describe('The distance to the latest block number'),
    range: z.object({
      fromBlock: z.coerce.number().describe('The from block number'),
      toBlock: z.coerce.number().describe('The to block number'),
    }),
    processing: z
      .object({
        avgTimeSec: z.coerce.number().optional().describe('Average processing time in seconds per range'),
        rangeCount: z.coerce.number().optional().describe('Number of ranges processed'),
      })
      .optional(),
    estimates: z
      .object({
        timeToHeadSec: z.coerce.number().optional().describe('Estimated time in seconds to reach chain head'),
      })
      .optional(),
    syncPct: z.coerce
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe('Sync percentage from start block to latest block (0-100)'),
  })
  .describe('The indexer state');

/**
 * The state of the indexer
 */
export type IndexerStateType = z.infer<typeof indexerStateZodSchema>;
