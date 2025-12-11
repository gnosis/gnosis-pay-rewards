import { BlockTag, PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes default timeout

export function waitForBlock<TBlockTag extends BlockTag>({
  blockNumber,
  blockTag,
  client,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  blockNumber: bigint;
  /**
   * The public client to use
   */
  client: PublicClient<Transport, typeof gnosis>;
  blockTag?: TBlockTag;
  /**
   * Timeout in milliseconds. If the block doesn't arrive within this time, the promise will reject.
   * Defaults to 5 minutes.
   */
  timeoutMs?: number;
}) {
  return new Promise((resolve, reject) => {
    let unwatch: (() => void) | undefined;
    let timeoutId: NodeJS.Timeout | number | undefined;

    const cleanup = () => {
      if (unwatch) {
        unwatch();
        unwatch = undefined;
      }
      if (timeoutId) {
        clearTimeout(timeoutId as unknown as number);
        timeoutId = undefined;
      }
    };

    const errorHandler = (error: Error) => {
      cleanup();
      reject(
        new Error(
          `Error watching for block ${blockNumber.toString()}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        ),
      );
    };

    // Set up timeout
    timeoutId = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timeout waiting for block ${blockNumber.toString()}. Block did not arrive within ${timeoutMs}ms.`,
        ),
      );
    }, timeoutMs) as unknown as number;

    // Set up block watcher
    try {
      unwatch = client.watchBlocks<false, TBlockTag>({
        blockTag: blockTag,
        onBlock(block) {
          if (block && block.number && block.number >= blockNumber) {
            cleanup();
            resolve(block);
          }
        },
        onError(error) {
          errorHandler(error);
        },
      });
    } catch (error) {
      errorHandler(error as Error);
    }
  });
}
