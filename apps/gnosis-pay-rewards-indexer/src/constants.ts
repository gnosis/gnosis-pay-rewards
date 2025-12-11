/**
 * Shared constants for the indexers
 */

import { gnosisPayStartBlock } from '@kpk/gnosis-pay-rewards-sdk';

const OLD_INDEXER_ID = 'full-index-to-head';
const OLD_INDEXER_START_BLOCK = gnosisPayStartBlock;

const NOV_2025_INDEXER_ID = 'nov-2025-to-head';
const NOV_2025_START_BLOCK = 42900000;

export { NOV_2025_INDEXER_ID, NOV_2025_START_BLOCK, OLD_INDEXER_ID, OLD_INDEXER_START_BLOCK };
