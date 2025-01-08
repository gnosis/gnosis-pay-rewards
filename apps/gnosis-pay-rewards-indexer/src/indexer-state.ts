import { bigMath, IndexerStateAtomType } from '@karpatkey/gnosis-pay-rewards-sdk';
import { atom, createStore } from 'jotai';
import { Logger } from 'winston';
import { dayjsUtc as dayjs } from './dayjs-utc.js';
import { PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';

/**
 * Atom for the indexer state with default values
 */
const indexerStateAtom = atom<IndexerStateAtomType>({
  startedAt: dayjs.utc().unix(),
  startBlock: 0n,
  fetchBlockSize: 12n * 5n,
  latestBlockNumber: 0n,
  distanceToLatestBlockNumber: 0n,
  range: {
    fromBlockNumber: 0n,
    toBlockNumber: 0n,
  },
});

/**
 * Store for the indexer state
 */
const indexerStateStore = createStore();

/**
 * Get the indexer state
 * @returns the indexer state
 */
export function getIndexerState() {
  return indexerStateStore.get(indexerStateAtom) as Readonly<IndexerStateAtomType>;
}

/**
 * Initialize the indexer state
 * @param client - the client to use for the initialization
 * @param fetchBlockSize - the block size to use for the initialization
 * @param logger - the logger to use for the initialization
 */
export async function initializeIndexerState(
  client: PublicClient<Transport, typeof gnosis>,
  fetchBlockSize: bigint,
  fromBlockNumberInitial: bigint,
  logger?: Logger
) {
  // Initialize the latest block
  const latestBlockInitial = await client.getBlock({ includeTransactions: false });
  const toBlockNumberInitial = clampToBlockRange(fromBlockNumberInitial, latestBlockInitial.number, fetchBlockSize);

  // Update the indexer state
  updateIndexerState(
    {
      startedAt: dayjs.utc().unix(),
      startBlock: fromBlockNumberInitial,
      fetchBlockSize,
      latestBlockNumber: latestBlockInitial.number,
      distanceToLatestBlockNumber: bigMath.abs(latestBlockInitial.number - fromBlockNumberInitial),
      range: {
        fromBlockNumber: fromBlockNumberInitial,
        toBlockNumber: toBlockNumberInitial,
      },
    },
    logger
  );
}

/**
 * Update the indexer state
 * @param newState - the new state to update
 * @param logger - the logger to use for the update
 */
function updateIndexerState(newState: Partial<IndexerStateAtomType>, logger?: Logger) {
  indexerStateStore.set(indexerStateAtom, (prevState) => {
    const changedKeys = Object.keys(newState).filter(
      (key) => newState[key as keyof IndexerStateAtomType] !== prevState[key as keyof IndexerStateAtomType]
    ) as (keyof IndexerStateAtomType)[];

    // Construct the next state
    const nextState = {
      ...prevState,
      ...newState,
    };

    const stateDiff = changedKeys.reduce((acc, key) => {
      if (key === 'range') {
        if (nextState.range.fromBlockNumber && prevState.range.fromBlockNumber !== nextState.range.fromBlockNumber) {
          acc['range.fromBlockNumber'] = {
            prev: prevState.range.fromBlockNumber,
            next: nextState.range.fromBlockNumber,
          };
        }
        if (nextState.range.toBlockNumber && prevState.range.toBlockNumber !== nextState.range.toBlockNumber) {
          acc['range.toBlockNumber'] = {
            prev: prevState.range.toBlockNumber,
            next: nextState.range.toBlockNumber,
          };
        }
      } else {
        if (prevState[key] !== nextState[key]) {
          acc[key] = {
            prev: prevState[key],
            next: nextState[key],
          };
        }
      }

      return acc;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }, {} as Record<string, { prev: any; next: any }>);

    logger?.debug(`updating indexer state`, { stateDiff });

    return nextState;
  });
}

/**
 * Update the distance to the latest block number
 * @param latestBlockNumber - the latest block number
 * @param logger - the logger to use for the update
 */
export function updateLatestBlockNumber(latestBlockNumber: bigint, logger?: Logger) {
  const indexerState = getIndexerState();

  // Validate the latest block number
  if (latestBlockNumber < indexerState.range.toBlockNumber) {
    throw new Error(
      `latest block number (${latestBlockNumber}) is less than the to block number (${indexerState.range.toBlockNumber})`
    );
  }

  const distanceToLatestBlockNumber = bigMath.abs(latestBlockNumber - indexerState.range.toBlockNumber);
  updateIndexerState(
    {
      latestBlockNumber,
      distanceToLatestBlockNumber,
    },
    logger
  );
}

/**
 * Move to the next block range
 * @param logger - the logger to use for the update
 * @returns the next range
 */
export function moveToNextBlockRange(logger?: Logger) {
  const { range, startBlock, fetchBlockSize, latestBlockNumber } = getIndexerState();

  const nextRange = {
    fromBlockNumber: range.fromBlockNumber + fetchBlockSize,
    toBlockNumber: clampToBlockRange(range.fromBlockNumber + fetchBlockSize, latestBlockNumber, fetchBlockSize),
  };

  // Validate the range
  if (nextRange.fromBlockNumber < startBlock) {
    throw new Error(
      `updateRange: fromBlockNumber (${nextRange.fromBlockNumber}) is less than the startBlock (${startBlock})`
    );
  }

  // from block number must be less than to block number
  if (nextRange.fromBlockNumber >= nextRange.toBlockNumber) {
    nextRange.fromBlockNumber = nextRange.toBlockNumber - fetchBlockSize;
    nextRange.toBlockNumber = clampToBlockRange(nextRange.fromBlockNumber, latestBlockNumber, fetchBlockSize);
  }

  const distanceToLatestBlockNumber = bigMath.abs(latestBlockNumber - nextRange.toBlockNumber);

  return updateIndexerState({ range: nextRange, distanceToLatestBlockNumber }, logger);
}

function clampToBlockRange(startBlock: bigint, latestBlockNumber: bigint, blockSize: bigint): bigint {
  const toBlock = startBlock + blockSize;
  return toBlock >= latestBlockNumber ? latestBlockNumber : toBlock;
}
